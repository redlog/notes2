import wx
from wx.adv import TaskBarIcon
import threading
import urllib.request
import webbrowser
from wx.lib.embeddedimage import PyEmbeddedImage

from flask_server import run_app
from config import Config

cfg = None

emb_icon = PyEmbeddedImage("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEiSURBVFhHYxgFo2DQAB0dnf9AiijMyMj4PyYmBsQGA3d3dww1+LCtrS2IBgNGKP0/KyuLYYf7IyiXMPiccpLh48ePDL9+/WKwtLRkOJ65HipDGHguT2TYvn07iMnIKCMj8z88PJxhvd1NsCQp4J7/FgZ9fX2Gi8U7oSLEA/el8QwsLCzgEPivtNEHIkoiYCq+wXDnzh0ojzTg6+vLcPnyZcocQC5o+x7DEBERAUp3DExQMbqCKs4lDNOmTWO4e/fuwDgABHqktzF8//594BwAA6MOGHXAqANGHTDqgFEHjDpg4B0gKirKkHDRDMqlHyh67MHAwcGBaJa3trYyzNU5DuXSFmTddmAoKSkBMWH2MzCIiYlhdCBohYWEhED0YAAMDACRVnh0V37IgQAAAABJRU5ErkJggg==")


class WxTaskBarIcon(TaskBarIcon):

    def __init__(self, frame):
        TaskBarIcon.__init__(self)
        self.frame = frame
        made_icon = emb_icon.GetIcon()
        self.SetIcon(made_icon, 'Localnotes')
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
        self.tskic = WxTaskBarIcon(self)
        self.Bind(wx.EVT_CLOSE, self.OnClose)
        self.Centre()

    def OnClose(self, event):
        self.tskic.Destroy()
        self.Destroy()


class WxApp(wx.App):

    def OnInit(self):
        frame = WxFrame(None, -1, '')
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
