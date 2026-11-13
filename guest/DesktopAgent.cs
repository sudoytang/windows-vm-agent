using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

public class AgentConfig { public string apiToken; public int apiPort; }

public static class DesktopAgent {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4000000, RecursionLimit = 64 };
    static readonly Dictionary<string, AutomationElement> Elements = new Dictionary<string, AutomationElement>();
    static readonly TreeWalker Walker = TreeWalker.ControlViewWalker;
    static string Root, Prefix;
    static AgentConfig Config;
    static int Snapshot, Nodes, MaxNodes;
    static bool Truncated, IncludeOffscreen;
    static DateTime CacheTime;

    static Dictionary<string, object> Obj(params object[] pairs) {
        var d = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) d[(string)pairs[i]] = pairs[i + 1];
        return d;
    }
    static string Str(Dictionary<string, object> d, string key, string fallback = "") {
        object v; return d != null && d.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : fallback;
    }
    static int Int(Dictionary<string, object> d, string key, int fallback = 0) {
        object v; return d != null && d.TryGetValue(key, out v) && v != null ? Convert.ToInt32(v) : fallback;
    }
    static string Clip(string s, int limit) {
        if (s == null) return ""; return s.Length <= limit ? s : s.Substring(0, limit) + "...";
    }
    static int QueryInt(HttpListenerRequest req, string name, int fallback) {
        int value; return int.TryParse(req.QueryString[name], out value) ? value : fallback;
    }
    static void Log(string message) {
        File.AppendAllText(Path.Combine(Root, "desktop.log"), DateTime.Now.ToString("o") + " " + message + Environment.NewLine);
    }
    static void SendJson(HttpListenerResponse res, object value, int status = 200) {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(value));
        res.StatusCode = status; res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = bytes.Length; res.OutputStream.Write(bytes, 0, bytes.Length);
    }
    static object TreeNode(AutomationElement element, int depth) {
        if (Nodes >= MaxNodes) { Truncated = true; return null; }
        try {
            var c = element.Current;
            if (c.IsOffscreen && !IncludeOffscreen) return null;
            string id = Prefix + ":" + (++Nodes);
            Elements[id] = element;
            var n = Obj("id", id, "role", c.ControlType.ProgrammaticName.Replace("ControlType.", ""), "name", Clip(c.Name, 600), "enabled", c.IsEnabled);
            if (!String.IsNullOrEmpty(c.AutomationId)) n["automationId"] = c.AutomationId;
            if (!String.IsNullOrEmpty(c.ClassName)) n["class"] = c.ClassName;
            if (!c.BoundingRectangle.IsEmpty) {
                var r = c.BoundingRectangle;
                n["bounds"] = new double[] { Math.Round(r.X), Math.Round(r.Y), Math.Round(r.Width), Math.Round(r.Height) };
            }
            if (c.IsOffscreen) n["offscreen"] = true;
            if (c.IsPassword) n["password"] = true;
            var actions = new List<string>();
            foreach (var p in element.GetSupportedPatterns()) actions.Add(p.ProgrammaticName.Replace("PatternIdentifiers.Pattern", ""));
            if (actions.Count > 0) n["actions"] = actions;
            if (!c.IsPassword) {
                object pattern;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) n["value"] = Clip(((ValuePattern)pattern).Current.Value, 2000);
                else if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) n["text"] = Clip(((TextPattern)pattern).DocumentRange.GetText(2000), 2000);
            }
            if (depth > 0) {
                var children = new List<object>();
                var child = Walker.GetFirstChild(element);
                while (child != null) {
                    object item = TreeNode(child, depth - 1);
                    if (item != null) children.Add(item);
                    if (Nodes >= MaxNodes) { Truncated = true; break; }
                    child = Walker.GetNextSibling(child);
                }
                if (children.Count > 0) n["children"] = children;
            }
            return n;
        } catch (ElementNotAvailableException) { return null; }
          catch (InvalidOperationException) { return null; }
    }
    static object GetTree(HttpListenerRequest req) {
        long hwnd; if (!Int64.TryParse(req.QueryString["hwnd"], out hwnd) || hwnd == 0) hwnd = VmDesktop.GetForegroundWindow().ToInt64();
        int depth = Math.Max(0, Math.Min(12, QueryInt(req, "depth", 5)));
        MaxNodes = Math.Max(1, Math.Min(1500, QueryInt(req, "maxNodes", 300)));
        IncludeOffscreen = req.QueryString["includeOffscreen"] == "true";
        Nodes = 0; Truncated = false; Prefix = "s" + (++Snapshot); CacheTime = DateTime.UtcNow; Elements.Clear();
        var root = AutomationElement.FromHandle(new IntPtr(hwnd));
        if (String.IsNullOrEmpty(req.QueryString["hwnd"])) {
            int pid = root.Current.ProcessId;
            for (int i = 0; i < 20 && root.Current.ControlType != ControlType.Window; i++) {
                var parent = Walker.GetParent(root);
                if (parent == null || parent.Current.ProcessId != pid) break;
                root = parent;
            }
            if (root.Current.NativeWindowHandle != 0) hwnd = root.Current.NativeWindowHandle;
        }
        object tree = TreeNode(root, depth);
        return Obj("hwnd", hwnd, "snapshot", Prefix, "nodes", Nodes, "truncated", Truncated, "tree", tree);
    }
    static object Action(Dictionary<string, object> b) {
        string id = Str(b, "id"), action = Str(b, "action");
        AutomationElement e;
        if ((DateTime.UtcNow - CacheTime).TotalSeconds > 120 || !Elements.TryGetValue(id, out e)) throw new Exception("Element ID expired; read a fresh tree");
        switch (action) {
            case "invoke": ((InvokePattern)e.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); break;
            case "setValue": if (!b.ContainsKey("value")) throw new Exception("value is required"); ((ValuePattern)e.GetCurrentPattern(ValuePattern.Pattern)).SetValue(Str(b, "value")); break;
            case "select": ((SelectionItemPattern)e.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); break;
            case "toggle": ((TogglePattern)e.GetCurrentPattern(TogglePattern.Pattern)).Toggle(); break;
            case "expand": ((ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); break;
            case "collapse": ((ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Collapse(); break;
            case "scrollIntoView": ((ScrollItemPattern)e.GetCurrentPattern(ScrollItemPattern.Pattern)).ScrollIntoView(); break;
            case "focus": e.SetFocus(); break;
            case "click": var point = e.GetClickablePoint(); VmDesktop.Click((int)point.X, (int)point.Y, "left", 1); break;
            default: throw new Exception("Unknown action");
        }
        return Obj("ok", true, "id", id, "action", action);
    }
    static byte[] Screenshot(HttpListenerRequest req) {
        var r = SystemInformation.VirtualScreen;
        if (req.QueryString["x"] != null) r = new Rectangle(QueryInt(req, "x", 0), QueryInt(req, "y", 0), QueryInt(req, "width", 0), QueryInt(req, "height", 0));
        if (r.Width < 1 || r.Height < 1 || r.Width > 8192 || r.Height > 8192) throw new Exception("Invalid capture bounds");
        using (var bitmap = new Bitmap(r.Width, r.Height))
        using (var g = Graphics.FromImage(bitmap))
        using (var ms = new MemoryStream()) {
            g.CopyFromScreen(r.Location, Point.Empty, r.Size);
            bitmap.Save(ms, ImageFormat.Png); return ms.ToArray();
        }
    }
    static bool Authorized(string header) {
        string expected = "Bearer " + Config.apiToken;
        if (header == null || header.Length != expected.Length) return false;
        int diff = 0; for (int i = 0; i < header.Length; i++) diff |= header[i] ^ expected[i]; return diff == 0;
    }
    static Dictionary<string, object> ReadBody(HttpListenerRequest req) {
        if (!req.HasEntityBody) return new Dictionary<string, object>();
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) {
            var s = new StringBuilder(); var b = new char[4096]; int n;
            while ((n = reader.Read(b, 0, b.Length)) > 0) { s.Append(b, 0, n); if (s.Length > 1048576) throw new Exception("Request too large"); }
            return Json.Deserialize<Dictionary<string, object>>(s.ToString());
        }
    }
    static void Handle(HttpListenerContext ctx) {
        var req = ctx.Request; var res = ctx.Response;
        try {
            if (!Authorized(req.Headers["Authorization"])) { SendJson(res, Obj("error", "Unauthorized"), 401); return; }
            var b = ReadBody(req); string route = req.HttpMethod + " " + req.Url.AbsolutePath;
            object result = null;
            switch (route) {
                case "GET /health": result = Obj("ok", true, "version", "1.0.0", "user", Environment.UserName, "sessionId", Process.GetCurrentProcess().SessionId, "foreground", VmDesktop.GetForegroundWindow().ToInt64(), "screen", Obj("width", SystemInformation.VirtualScreen.Width, "height", SystemInformation.VirtualScreen.Height), "elevated", new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)); break;
                case "GET /windows": result = Obj("windows", VmDesktop.Windows()); break;
                case "GET /ui/tree": result = GetTree(req); break;
                case "POST /ui/action": result = Action(b); break;
                case "POST /window/focus": var h = new IntPtr(Convert.ToInt64(b["hwnd"])); VmDesktop.ShowWindow(h, 9); bool ok = VmDesktop.SetForegroundWindow(h); if (!ok) { try { AutomationElement.FromHandle(h).SetFocus(); ok = true; } catch {} } System.Threading.Thread.Sleep(100); result = Obj("ok", ok, "foreground", VmDesktop.GetForegroundWindow().ToInt64()); break;
                case "POST /input/text": VmDesktop.Text(Str(b, "text")); result = Obj("ok", true); break;
                case "POST /input/key": VmDesktop.Key(Str(b, "keys")); result = Obj("ok", true); break;
                case "POST /input/click": if (!b.ContainsKey("x") || !b.ContainsKey("y")) throw new Exception("x/y are required"); VmDesktop.Click(Int(b, "x"), Int(b, "y"), Str(b, "button", "left"), Math.Max(1, Math.Min(2, Int(b, "count", 1)))); result = Obj("ok", true); break;
                case "POST /input/scroll": VmDesktop.Wheel(Math.Max(-30, Math.Min(30, Int(b, "steps")))); result = Obj("ok", true); break;
                case "POST /app/launch": var info = new ProcessStartInfo(Str(b, "file")); object av; if (b.TryGetValue("args", out av) && av != null) { var list = new List<string>(); foreach (object a in (System.Collections.IEnumerable)av) list.Add(Quote(Convert.ToString(a))); info.Arguments = String.Join(" ", list); } info.WorkingDirectory = Str(b, "cwd", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)); var p = Process.Start(info); result = Obj("ok", true, "pid", p == null ? 0 : p.Id); break;
                case "GET /screenshot": var bytes = Screenshot(req); res.ContentType = "image/png"; res.ContentLength64 = bytes.Length; res.OutputStream.Write(bytes, 0, bytes.Length); return;
                default: SendJson(res, Obj("error", "Unknown endpoint"), 404); return;
            }
            SendJson(res, result); Log(route + " " + res.StatusCode);
        } catch (Exception e) { try { SendJson(res, Obj("error", e.Message), 400); } catch {} }
        finally { res.Close(); }
    }
    static string Quote(string value) {
        if (value.Length > 0 && value.IndexOfAny(new char[] {' ', '\t', '"'}) < 0) return value;
        var s = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) { if (c == '\\') { slashes++; continue; } if (c == '"') { s.Append('\\', slashes * 2 + 1); s.Append(c); } else { s.Append('\\', slashes); s.Append(c); } slashes = 0; }
        s.Append('\\', slashes * 2); return s.Append('"').ToString();
    }
    [STAThread]
    public static void Main(string[] args) {
        Root = AppDomain.CurrentDomain.BaseDirectory;
        try {
            VmDesktop.SetProcessDPIAware(); VmDesktop.SetThreadDpiAwarenessContext(new IntPtr(-4));
            string path = args.Length > 0 ? args[0] : Path.Combine(Root, "config.json");
            Config = Json.Deserialize<AgentConfig>(File.ReadAllText(path));
            if (String.IsNullOrEmpty(Config.apiToken) || Config.apiToken.Length < 32) throw new Exception("API token missing");
            using (var listener = new HttpListener()) {
                listener.Prefixes.Add("http://127.0.0.1:" + Config.apiPort + "/"); listener.Start();
                Log("started session=" + Process.GetCurrentProcess().SessionId);
                while (listener.IsListening) Handle(listener.GetContext());
            }
        } catch (Exception e) { File.AppendAllText(Path.Combine(Root, "desktop-error.log"), e.ToString() + Environment.NewLine); Environment.ExitCode = 1; }
    }
}
