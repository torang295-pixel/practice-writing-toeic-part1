using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MyTOEIC;

public sealed partial class AiService : IDisposable
{
    public const string PreparePrompt = """
You create TOEIC Writing Part 1 exercises.
Analyze the image. Output exactly two distinct, common English cue words naturally usable together in ONE sentence accurately describing the image (one concrete noun and one verb/adjective/preposition).
Return ONLY JSON: {"words":["word1","word2"]}.
""";

    public const string GradePrompt = """
You are an expert TOEIC Writing Part 1 evaluator. Evaluate ONE English sentence based on the supplied image and BOTH required cue words (allowing valid inflections: plurals, tenses, participles).
Score strictly on the standard ETS 0-3 scale:
3: Accurate image description, both cues used correctly, no grammar or spelling errors.
2: Main image content correct, both cues used correctly, minor grammar, tense, preposition, or spelling errors that do not obscure meaning.
1: Only partly related to image, or serious grammar errors despite use of cues; awkward or hard-to-understand structure.
0: Blank, meaningless, unrelated to image, or either required cue missing (allow valid inflections).

Provide a fast, concise evaluation in Vietnamese. Keep each text field to 1 sharp, direct sentence (max 20 words per field) without filler words:
- summary: Nhận xét tổng quan ngắn gọn (1 câu).
- criteria:
  - image_relevance: Độ khớp hành động/chi tiết trong ảnh (1 câu ngắn).
  - cues_usage: Việc dùng 2 từ gợi ý và dạng chia từ (1 câu ngắn).
  - grammar: Ngữ pháp, thì, mạo từ, cấu trúc câu (1 câu ngắn).
- errors: Danh sách các lỗi sai thực tế. Mỗi lỗi gồm: {"issue": "Tên lỗi (2-4 từ)", "detail": "Lý do sai và cách sửa (1 câu)"}. Nếu đạt 3 điểm không có lỗi, để mảng rỗng [].
- correction: Câu tiếng Anh sửa tối thiểu từ câu của thí sinh để thành câu đúng chuẩn.
- better_sentence: Một câu tiếng Anh mẫu tự nhiên điểm tối đa cho bức ảnh này.
- better_sentence_vi: Dịch câu gợi ý (better_sentence) sang tiếng Việt tự nhiên, ngắn gọn (1 câu).

Return ONLY valid JSON matching this schema:
{
  "score": 0,
  "summary": "Nhận xét tổng quan 1 câu",
  "criteria": {
    "image_relevance": "Độ khớp ảnh",
    "cues_usage": "Cách dùng từ",
    "grammar": "Đánh giá ngữ pháp"
  },
  "errors": [
    { "issue": "Tên lỗi", "detail": "Chi tiết sửa" }
  ],
  "correction": "Minimal corrected sentence",
  "better_sentence": "Natural alternative sentence",
  "better_sentence_vi": "Dịch tiếng Việt của câu gợi ý"
}
""";

    private readonly HttpClient client;
    private readonly bool ownsClient;

    public AiService(HttpClient? client = null)
    {
        ownsClient = client is null;
        this.client = client ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
        this.client.Timeout = Timeout.InfiniteTimeSpan;
    }

    public async Task<JsonObject> ExecuteAsync(AiRequest request, CancellationToken cancellationToken)
    {
        var endpoint = Validate(request);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        HttpResponseMessage response;
        for (var attempt = 0; ; attempt++)
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, endpoint);
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiKey.Trim());
            message.Content = new StringContent(BuildPayload(request), Encoding.UTF8, "application/json");
            try { response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new UserException("AI phản hồi quá 45 giây. Hãy thử lại."); }
            catch (HttpRequestException) { throw new UserException("Không kết nối được API. Kiểm tra mạng và base URL."); }
            if (response.StatusCode != HttpStatusCode.ServiceUnavailable || attempt == 2) break;
            response.Dispose();
            try { await Task.Delay(TimeSpan.FromSeconds(1 << attempt), timeout.Token); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new UserException("AI phản hồi quá 45 giây. Hãy thử lại."); }
        }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new UserException(response.StatusCode switch
                {
                    HttpStatusCode.Unauthorized => "API key không hợp lệ.",
                    HttpStatusCode.Forbidden => "API key không có quyền dùng model.",
                    HttpStatusCode.TooManyRequests => "Hết hạn mức hoặc quá nhiều yêu cầu. Kiểm tra tài khoản API.",
                    _ => $"Nhà cung cấp trả HTTP {(int)response.StatusCode}. Kiểm tra base URL, model hỗ trợ ảnh và JSON mode."
                });
            }
            var raw = await ReadLimitedAsync(response.Content, timeout.Token);
            return ParseResult(ReadCompletion(raw), request.Action);
        }
    }

    public static Uri Validate(AiRequest request)
    {
        if (request.Action is not ("prepare" or "grade")) throw new UserException("Thao tác không hợp lệ.");
        if (string.IsNullOrWhiteSpace(request.ApiKey) || request.ApiKey.Length > 1000) throw new UserException("Cần API key hợp lệ.");
        if (string.IsNullOrWhiteSpace(request.Model) || request.Model.Length > 150) throw new UserException("Cần tên model hỗ trợ ảnh.");
        if (!Uri.TryCreate(request.BaseUrl, UriKind.Absolute, out var url)) throw new UserException("API base URL không hợp lệ.");
        var localHttp = url.Scheme == Uri.UriSchemeHttp && (url.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.TryParse(url.Host, out var ip) && IPAddress.IsLoopback(ip));
        if (url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0 || url.Scheme != Uri.UriSchemeHttps && !localHttp) throw new UserException("API base URL phải dùng HTTPS hoặc HTTP trên localhost, không chứa tài khoản, query hoặc fragment.");
        if (string.IsNullOrWhiteSpace(request.Image) || !ImageRegex().IsMatch(request.Image) || request.Image.Length > 7_000_000) throw new UserException("Ảnh không hợp lệ hoặc quá lớn.");
        if (request.Action == "grade")
        {
            if (request.Words is not { Length: 2 } || request.Words.Any(word => word is null || !WordRegex().IsMatch(word)) || request.Words[0].Equals(request.Words[1], StringComparison.OrdinalIgnoreCase)) throw new UserException("Cần đúng hai từ gợi ý khác nhau.");
            if (request.Answer is null || request.Answer.Length > 2000) throw new UserException("Câu trả lời tối đa 2.000 ký tự.");
        }
        return new Uri(url.ToString().TrimEnd('/') + "/chat/completions");
    }

    public static string ReadCompletion(string raw)
    {
        JsonNode? data;
        try { data = JsonNode.Parse(raw); }
        catch (JsonException) { throw new UserException(raw.TrimStart().StartsWith("data:") ? "Router trả dữ liệu streaming dù đã yêu cầu stream=false. Kiểm tra cấu hình 9router." : "API không trả JSON Chat Completions. Kiểm tra base URL của 9router (đường dẫn API, không phải trang quản trị)."); }
        var choice = data?["choices"]?[0];
        if (choice?["finish_reason"]?.GetValue<string>() == "length") throw new UserException("Phản hồi AI bị cắt do giới hạn token. Chọn model ít reasoning hơn.");
        if (choice?["message"]?["refusal"] is not null || choice?["finish_reason"]?.GetValue<string>() == "content_filter") throw new UserException("Model từ chối xử lý nội dung này. Hãy dùng ảnh khác.");
        var content = choice?["message"]?["content"];
        string? text = content is JsonValue ? content.GetValue<string>() : content is JsonArray parts ? string.Join('\n', parts.Select(part => part?["type"]?.GetValue<string>() == "text" ? part?["text"]?.GetValue<string>() : null).Where(part => part is not null)) : null;
        if (string.IsNullOrWhiteSpace(text)) throw new UserException("API không trả nội dung AI trong choices[0].message.content. Kiểm tra model và khả năng hỗ trợ ảnh của router.");
        return text;
    }

    public static JsonObject ParseResult(string content, string action)
    {
        var text = ThinkRegex().Replace(content, "").Trim();
        var candidates = new List<string> { text };
        candidates.AddRange(FenceRegex().Matches(text).Select(match => match.Groups[1].Value));
        var start = text.IndexOf('{'); var end = text.LastIndexOf('}');
        if (start >= 0 && end > start) candidates.Add(text[start..(end + 1)]);
        JsonObject? result = null;
        foreach (var candidate in candidates)
        {
            try { result = JsonNode.Parse(candidate) as JsonObject; if (result is not null) break; } catch (JsonException) { }
        }
        if (result is null) throw new UserException("Model không trả đối tượng JSON hợp lệ theo đề bài. Chọn model hỗ trợ JSON mode và ảnh; phản hồi có thể đã bị cắt.");
        if (result["error"] is JsonValue error) throw new UserException(error.ToString()[..Math.Min(error.ToString().Length, 300)]);
        if (action == "prepare")
        {
            var words = result["words"] as JsonArray;
            if (words is not { Count: 2 } || words.Any(word => word is null || !WordRegex().IsMatch(word.GetValue<string>())) || words[0]!.GetValue<string>().Equals(words[1]!.GetValue<string>(), StringComparison.OrdinalIgnoreCase)) throw new UserException("AI không trả đúng hai từ gợi ý. Hãy thử lại.");
            return new JsonObject { ["words"] = new JsonArray(words.Select(word => JsonValue.Create(word!.GetValue<string>().ToLowerInvariant())).ToArray()) };
        }
        if (result["score"] is not JsonValue scoreValue || !scoreValue.TryGetValue<int>(out var score) || score is < 0 or > 3 || result["summary"] is not JsonValue summary || summary.ToString().Length > 1000 || result["correction"] is not JsonValue correction || string.IsNullOrWhiteSpace(correction.ToString()) || correction.ToString().Length > 2000 || result["better_sentence"] is not JsonValue betterSentence || string.IsNullOrWhiteSpace(betterSentence.ToString()) || betterSentence.ToString().Length > 2000 || result["better_sentence_vi"] is not JsonValue translation || string.IsNullOrWhiteSpace(translation.ToString()) || translation.ToString().Length > 2000) throw new UserException("Kết quả chấm thiếu câu gợi ý hoặc bản dịch tiếng Việt. Hãy thử chấm lại.");
        return result;
    }

    public static string BuildPayload(AiRequest request)
    {
        string userText;
        if (request.Action == "prepare")
        {
            userText = request.Words is { Length: > 0 }
                ? $"Analyze this image. Output two distinct English cue words DIFFERENT from: {string.Join(", ", request.Words)}. Return JSON: {{\"words\":[\"word1\",\"word2\"]}}"
                : "Analyze this image and output two distinct English cue words. Return JSON: {\"words\":[\"word1\",\"word2\"]}";
        }
        else
        {
            userText = JsonSerializer.Serialize(new { words = request.Words, answer = request.Answer });
        }
        var payload = new JsonObject
        {
            ["model"] = request.Model.Trim(),
            ["stream"] = false,
            ["temperature"] = 0.2,
            ["max_tokens"] = request.Action == "prepare" ? 300 : 2000,
            ["response_format"] = new JsonObject { ["type"] = "json_object" },
            ["messages"] = JsonSerializer.SerializeToNode(new object[]
            {
                new { role = "system", content = request.Action == "prepare" ? PreparePrompt : GradePrompt },
                new { role = "user", content = new object[]
                {
                    new { type = "text", text = userText },
                    new { type = "image_url", image_url = new { url = request.Image, detail = "low" } }
                }}
            })
        };
        if (request.BaseUrl.Contains("generativelanguage.googleapis.com", StringComparison.OrdinalIgnoreCase)) payload["reasoning_effort"] = "minimal";
        return payload.ToJsonString();
    }

    private static async Task<string> ReadLimitedAsync(HttpContent content, CancellationToken token)
    {
        await using var stream = await content.ReadAsStreamAsync(token);
        using var memory = new MemoryStream(); var buffer = new byte[8192]; int read;
        while ((read = await stream.ReadAsync(buffer, token)) > 0) { if (memory.Length + read > 2_000_000) throw new UserException("Phản hồi API quá lớn."); await memory.WriteAsync(buffer.AsMemory(0, read), token); }
        return Encoding.UTF8.GetString(memory.ToArray());
    }

    public void Dispose() { if (ownsClient) client.Dispose(); }
    [GeneratedRegex(@"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$", RegexOptions.IgnoreCase)] private static partial Regex ImageRegex();
    [GeneratedRegex(@"^[a-zA-Z]{1,40}$")] private static partial Regex WordRegex();
    [GeneratedRegex(@"<think>[\s\S]*?</think>", RegexOptions.IgnoreCase)] private static partial Regex ThinkRegex();
    [GeneratedRegex(@"```(?:json)?\s*([\s\S]*?)```", RegexOptions.IgnoreCase)] private static partial Regex FenceRegex();
}

public sealed record AiRequest(string Action, string BaseUrl, string ApiKey, string Model, string Image, string[]? Words, string? Answer);
public sealed class UserException(string message) : Exception(message);
