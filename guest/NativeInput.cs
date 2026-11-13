using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class VmDesktop {
  public delegate bool EnumProc(IntPtr hwnd,IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder s,int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int command);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] inputs,int size);
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {public int x,y;public uint data,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {public ushort key,scan;public uint flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)]public MOUSEINPUT mouse;[FieldOffset(0)]public KEYBDINPUT keyboard;}
  [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
  public class Window {public long hwnd;public uint pid;public string title;public bool active;}
  public static Window[] Windows(){var list=new List<Window>();var active=GetForegroundWindow();EnumWindows((hwnd,p)=>{if(!IsWindowVisible(hwnd))return true;var s=new StringBuilder(1024);GetWindowText(hwnd,s,s.Capacity);if(s.Length==0)return true;uint pid;GetWindowThreadProcessId(hwnd,out pid);list.Add(new Window{hwnd=hwnd.ToInt64(),pid=pid,title=s.ToString(),active=hwnd==active});return true;},IntPtr.Zero);return list.ToArray();}
  public static void Click(int x,int y,string button,int count){SetCursorPos(x,y);uint down=button=="right"?8u:2u,up=button=="right"?16u:4u;for(int i=0;i<count;i++){mouse_event(down,0,0,0,UIntPtr.Zero);System.Threading.Thread.Sleep(35);mouse_event(up,0,0,0,UIntPtr.Zero);System.Threading.Thread.Sleep(70);}}
  public static void Wheel(int steps){mouse_event(0x800,0,0,unchecked((uint)(steps*120)),UIntPtr.Zero);}
  public static void Text(string text){foreach(char c in text){var a=new INPUT[2];a[0].type=a[1].type=1;a[0].data.keyboard.scan=a[1].data.keyboard.scan=c;a[0].data.keyboard.flags=4;a[1].data.keyboard.flags=6;if(SendInput(2,a,Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("SendInput failed; desktop may be locked or elevated");System.Threading.Thread.Sleep(12);}}
  public static void Key(string chord){var names=new Dictionary<string,byte>(StringComparer.OrdinalIgnoreCase){{"CTRL",17},{"CONTROL",17},{"ALT",18},{"SHIFT",16},{"WIN",91},{"ENTER",13},{"RETURN",13},{"ESC",27},{"ESCAPE",27},{"TAB",9},{"SPACE",32},{"BACKSPACE",8},{"DELETE",46},{"INSERT",45},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34},{"UP",38},{"DOWN",40},{"LEFT",37},{"RIGHT",39}};var keys=new List<byte>();foreach(string part in chord.Split('+')){byte k;if(names.TryGetValue(part,out k))keys.Add(k);else if(part.Length==1){short code=VkKeyScan(char.IsLetter(part[0])?char.ToLowerInvariant(part[0]):part[0]);if(code<0)throw new Exception("Unsupported key");if((code&256)!=0&&!keys.Contains(16))keys.Add(16);keys.Add((byte)(code&255));}else if(part.StartsWith("F",StringComparison.OrdinalIgnoreCase)){int f;if(!int.TryParse(part.Substring(1),out f)||f<1||f>24)throw new Exception("Invalid function key");keys.Add((byte)(111+f));}else throw new Exception("Unknown key: "+part);}foreach(byte k in keys){keybd_event(k,0,0,UIntPtr.Zero);System.Threading.Thread.Sleep(30);}System.Threading.Thread.Sleep(100);keys.Reverse();foreach(byte k in keys){keybd_event(k,0,2,UIntPtr.Zero);System.Threading.Thread.Sleep(20);}}
}