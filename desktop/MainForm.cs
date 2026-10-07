using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MyTOEIC;

public sealed class MainForm : Form
{
    private const string AppOrigin = "https://appassets.local";
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly AiService ai = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly EventWaitHandle showEvent;
    private readonly Thread showThread;
    private string apiKey = "";

    public MainForm(EventWaitHandle showEvent)
    {
        this.showEvent = showEvent;
        Text = "my toeic";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(920, 680);
        Size = new Size(1280, 850);
        var iconPath = Path.Combine(AppContext.BaseDirectory, "app.ico");
        if (File.Exists(iconPath)) { try { Icon = new Icon(iconPath); } catch { } }
        Controls.Add(webView);
        showThread = new Thread(WaitForShow) { IsBackground = true };
        Shown += async (_, _) => await InitializeAsync();
        FormClosing += (_, _) => lifetime.Cancel();
        showThread.Start();
    }

    private async Task InitializeAsync()
    {
        try
        {
            var dataPath = Path.Combine(AppContext.BaseDirectory, "data");
            var legacy1 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Sentence Lab", "data");
            var legacy2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SentenceLab", "WebView2");
            if (!Directory.Exists(dataPath))
            {
                if (Directory.Exists(legacy1)) { try { CopyDirectory(legacy1, dataPath); } catch { } }
                else if (Directory.Exists(legacy2)) { try { CopyDirectory(legacy2, dataPath); } catch { } }
            }
            Directory.CreateDirectory(dataPath);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataPath);
            await webView.EnsureCoreWebView2Async(environment);
            var core = webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("appassets.local", Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, eventArgs) => { if (!eventArgs.Uri.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase)) eventArgs.Cancel = true; };
            core.NewWindowRequested += (_, eventArgs) => { eventArgs.Handled = true; if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps) Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); };
            core.WebMessageReceived += OnWebMessageReceived;
            core.Navigate(AppOrigin + "/index.html?desktop=1");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Máy chưa có Microsoft Edge WebView2 Runtime. Hãy cài WebView2 Runtime rồi mở lại ứng dụng.", "Không thể khởi động", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
        catch (Exception error)
        {
            MessageBox.Show($"Không thể khởi động ứng dụng.\n\n{error.Message}", "Sentence Lab", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (!eventArgs.Source.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        string? id = null;
        try
        {
            var message = JsonNode.Parse(eventArgs.WebMessageAsJson)?.AsObject() ?? throw new UserException("Tin nhắn desktop không hợp lệ.");
            id = message["id"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(id) || message["type"]?.GetValue<string>() != "ai") throw new UserException("Yêu cầu desktop không hợp lệ.");
            var payload = message["payload"]?.Deserialize<BridgePayload>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new UserException("Thiếu dữ liệu yêu cầu.");
            if (!string.IsNullOrWhiteSpace(payload.ApiKey)) apiKey = payload.ApiKey;
            var result = await ai.ExecuteAsync(new AiRequest(payload.Action ?? "", payload.BaseUrl ?? "", apiKey, payload.Model ?? "", payload.Image ?? "", payload.Words, payload.Answer), lifetime.Token);
            Post(new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result });
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (id is not null) Post(new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = error is UserException ? error.Message : "Ứng dụng không thể xử lý yêu cầu AI." });
        }
    }

    private void Post(JsonObject message)
    {
        if (!IsDisposed && webView.CoreWebView2 is not null) webView.CoreWebView2.PostWebMessageAsJson(message.ToJsonString());
    }

    private void WaitForShow()
    {
        while (!lifetime.IsCancellationRequested)
        {
            if (!showEvent.WaitOne(500)) continue;
            if (IsDisposed) return;
            BeginInvoke(() => { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); BringToFront(); });
        }
    }

    private static void CopyDirectory(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        foreach (var file in Directory.GetFiles(sourceDir))
        {
            try { File.Copy(file, Path.Combine(destinationDir, Path.GetFileName(file)), true); } catch { }
        }
        foreach (var directory in Directory.GetDirectories(sourceDir))
        {
            try { CopyDirectory(directory, Path.Combine(destinationDir, Path.GetFileName(directory))); } catch { }
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { lifetime.Cancel(); webView.Dispose(); ai.Dispose(); lifetime.Dispose(); }
        base.Dispose(disposing);
    }

    private sealed record BridgePayload(string? Action, string? BaseUrl, string? ApiKey, string? Model, string? Image, string[]? Words, string? Answer);
}
