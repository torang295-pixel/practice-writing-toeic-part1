using System.Text.Json.Nodes;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace MyTOEIC.Tests;

[TestClass]
public sealed class AiServiceTests
{
    private static AiRequest Valid(string baseUrl = "https://api.openai.com/v1") => new("prepare", baseUrl, "test-key", "vision-model", "data:image/jpeg;base64,YQ==", null, null);

    [TestMethod]
    public void BuildsRemoteAndLocalEndpoints()
    {
        Assert.AreEqual("https://api.openai.com/v1/chat/completions", AiService.Validate(Valid()).ToString());
        foreach (var host in new[] { "localhost", "127.0.0.1", "[::1]" }) Assert.AreEqual($"http://{host}:20128/v1/chat/completions", AiService.Validate(Valid($"http://{host}:20128/v1")).ToString());
    }

    [TestMethod]
    public void RejectsUnsafeEndpointsAndInvalidInput()
    {
        foreach (var url in new[] { "http://example.com/v1", "http://192.168.1.2/v1", "http://user:pass@localhost/v1", "http://localhost/v1?key=x", "ftp://localhost/v1" }) Assert.ThrowsExactly<UserException>(() => AiService.Validate(Valid(url)));
        Assert.ThrowsExactly<UserException>(() => AiService.Validate(Valid() with { Image = "https://example.com/image.jpg" }));
        Assert.ThrowsExactly<UserException>(() => AiService.Validate(Valid() with { ApiKey = "" }));
        Assert.ThrowsExactly<UserException>(() => AiService.Validate(Valid() with { Action = "grade", Words = ["walk", "WALK"], Answer = "Hello" }));
    }

    [TestMethod]
    public void BuildsGeminiPayloadWithMinimalReasoningAndEnoughOutputTokens()
    {
        var gemini = Valid("https://generativelanguage.googleapis.com/v1beta/openai") with { Action = "grade", Model = "gemini-3.5-flash-lite", Words = ["books", "shelf"], Answer = "Books are on the shelf." };
        var geminiPayload = JsonNode.Parse(AiService.BuildPayload(gemini))!.AsObject();
        Assert.AreEqual("minimal", geminiPayload["reasoning_effort"]!.GetValue<string>());
        Assert.AreEqual(2000, geminiPayload["max_tokens"]!.GetValue<int>());

        var openAiPayload = JsonNode.Parse(AiService.BuildPayload(Valid()))!.AsObject();
        Assert.IsNull(openAiPayload["reasoning_effort"]);
        Assert.AreEqual(300, openAiPayload["max_tokens"]!.GetValue<int>());
    }

    [TestMethod]
    public void ReadsRouterEnvelopeAndReportsTransportErrors()
    {
        Assert.AreEqual("hello", AiService.ReadCompletion("{\"choices\":[{\"message\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}]}"));
        Assert.ThrowsExactly<UserException>(() => AiService.ReadCompletion("<html>Dashboard</html>"));
        Assert.ThrowsExactly<UserException>(() => AiService.ReadCompletion("data: {}"));
        Assert.ThrowsExactly<UserException>(() => AiService.ReadCompletion("{\"choices\":[{\"message\":{\"content\":\"{\"},\"finish_reason\":\"length\"}]}"));
    }

    [TestMethod]
    public void ParsesWrappedPrepareAndGradeResults()
    {
        var prepared = AiService.ParseResult("<think>ignored</think>```json\n{\"words\":[\"Man\",\"Walk\"]}\n```", "prepare");
        CollectionAssert.AreEqual(new[] { "man", "walk" }, prepared["words"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray());
        var graded = AiService.ParseResult("{\"score\":3,\"summary\":\"Đúng.\",\"errors\":[],\"correction\":\"A man is walking.\",\"better_sentence\":\"A man is walking.\",\"better_sentence_vi\":\"Một người đàn ông đang đi bộ.\"}", "grade");
        Assert.AreEqual(3, graded["score"]!.GetValue<int>());
        var rich = AiService.ParseResult("{\"score\":2,\"summary\":\"Tốt\",\"criteria\":{\"image_relevance\":\"Sát ảnh\",\"cues_usage\":\"Đúng từ\",\"grammar\":\"Lỗi mạo từ\"},\"errors\":[{\"issue\":\"Thiếu mạo từ\",\"detail\":\"Cần thêm 'a'\"}],\"correction\":\"A man is walking.\",\"better_sentence\":\"A man walks.\",\"better_sentence_vi\":\"Một người đàn ông đi bộ.\",\"advice\":\"Chú ý mạo từ\"}", "grade");
        Assert.AreEqual(2, rich["score"]!.GetValue<int>());
        Assert.AreEqual("Sát ảnh", rich["criteria"]!["image_relevance"]!.GetValue<string>());
        Assert.AreEqual("Một người đàn ông đi bộ.", rich["better_sentence_vi"]!.GetValue<string>());
        Assert.ThrowsExactly<UserException>(() => AiService.ParseResult("not JSON", "prepare"));
        Assert.ThrowsExactly<UserException>(() => AiService.ParseResult("{\"score\":3,\"summary\":\"Đúng\",\"errors\":[],\"correction\":\"Text\",\"better_sentence\":\"Sentence\"}", "grade"));
        Assert.ThrowsExactly<UserException>(() => AiService.ParseResult("{\"score\":4,\"summary\":\"Sai\",\"errors\":[],\"correction\":\"Text\"}", "grade"));
    }
}
