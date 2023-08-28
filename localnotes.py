import wx
from wx.adv import TaskBarIcon
import threading
import urllib.request
import webbrowser

from flask_server import run_app
from config import Config

cfg = None


class WxTaskBarIcon(TaskBarIcon):

    def __init__(self, frame):
        TaskBarIcon.__init__(self)
        self.frame = frame
        self.SetIcon(wx.Icon('localnotes_icon.png', wx.BITMAP_TYPE_PNG), 'Localnotes')
        self.Bind(wx.EVT_MENU, self.OnTaskBarOpen, id=1)
        self.Bind(wx.EVT_MENU, self.OnTaskBarClose, id=2)

    def CreatePopupMenu(self):
        menu = wx.Menu()
        menu.Append(1, 'Open')
        menu.Append(2, 'Close')
        return menu

    def OnTaskBarOpen(self, event):
        port = cfg.get_http_port()
        url = "http://localhost:{0}".format(port)
        webbrowser.open(url, new=1, autoraise=True)

    def OnTaskBarClose(self, event):
        self.frame.Close()
        port = cfg.get_http_port()
        url = "http://localhost:{0}/exit_cleanly".format(port)
        _ = urllib.request.urlopen(url).read()


class WxFrame(wx.Frame):
    def __init__(self, parent, id, title):
        wx.Frame.__init__(self, parent, id, title, (-1, -1), (290, 280))
        self.SetIcon(wx.Icon('localnotes_icon.png', wx.BITMAP_TYPE_PNG))
        self.SetSize((350, 250))
        self.tskic = WxTaskBarIcon(self)
        self.Bind(wx.EVT_CLOSE, self.OnClose)
        self.Centre()

    def OnClose(self, event):
        self.tskic.Destroy()
        self.Destroy()


class WxApp(wx.App):

    def OnInit(self):
        frame = WxFrame(None, -1, 'wx.adv - TaskBarIcon')
        #frame.Show(True)
        self.SetTopWindow(frame)
        return True


if __name__ == '__main__':
    cfg = Config()
    cfg.load()

    # run the flask server in a separate thread
    flask_thread = threading.Thread(target=run_app, args=(cfg,))
    flask_thread.start()

    # start the wxpython app
    wx_app = WxApp(0)
    wx_app.MainLoop()
