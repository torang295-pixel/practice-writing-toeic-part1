using System.Threading;

namespace MyTOEIC;

internal static class Program
{
    private const string MutexName = @"Local\MyTOEIC.Desktop";
    private const string ShowEventName = @"Local\MyTOEIC.Desktop.Show";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var firstInstance);
        if (!firstInstance)
        {
            try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { }
            return;
        }

        ApplicationConfiguration.Initialize();
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var form = new MainForm(showEvent);
        Application.Run(form);
    }
}
