import os
import json


class Config(object):

    def __init__(self):
        # defaults
        self.BASE_PATH = os.getcwd()
        self.NOTES_DIR = "all_notes"
        self.LINK_COLOR = "#556B2F"
        self.ALERT_COLOR = "#FF0000"
        self.FOCAL_COLOR = "#4C3017"
        self.TEXT_COLOR = "#1D0F01"
        self.BACKGROUND_COLOR = "#F5F5F5"
        self.DEFAULT_NN = 25
        self.HTTP_PORT = 80
        self.INDEX_TRIGRAMS = 0
        self.INDEX_STEMMING = 0
        self.HEADER_COLOR = "#A0A0A0"  # "#C6893E"
        self.SIDEBAR_COLOR = "#CBC7C4"
        self.USAGE_STATS = 0
        self.LIST_COMPACT = 0

    @staticmethod
    def get_config_file_name() -> str:
        return os.path.join(os.getcwd(), "config.json")

    @staticmethod
    def read_config_file() -> dict:
        fn = Config.get_config_file_name()
        with open(fn, "r") as fp:
            b = fp.read()
            cfg = json.loads(b)
            return cfg

    def load(self) -> None:
        fn = Config.get_config_file_name()

        # read the config file if it exists
        cfg = {}
        if os.path.exists(fn):
            cfg = Config.read_config_file()

        # when necessary populate it with defaults
        self.BASE_PATH = cfg.get('BASE_PATH', self.BASE_PATH)
        self.NOTES_DIR = cfg.get('NOTES_DIR', self.NOTES_DIR)
        self.LINK_COLOR = cfg.get('LINK_COLOR', self.LINK_COLOR)
        self.ALERT_COLOR = cfg.get('ALERT_COLOR', self.ALERT_COLOR)
        self.FOCAL_COLOR = cfg.get('FOCAL_COLOR', self.FOCAL_COLOR)
        self.BACKGROUND_COLOR = cfg.get('BACKGROUND_COLOR', self.BACKGROUND_COLOR)
        self.HEADER_COLOR = cfg.get('HEADER_COLOR', self.HEADER_COLOR)
        self.SIDEBAR_COLOR = cfg.get('SIDEBAR_COLOR', self.SIDEBAR_COLOR)
        self.TEXT_COLOR = cfg.get('TEXT_COLOR', self.TEXT_COLOR)
        self.DEFAULT_NN = cfg.get('DEFAULT_NN', self.DEFAULT_NN)
        self.HTTP_PORT = cfg.get('HTTP_PORT', self.HTTP_PORT)
        self.INDEX_TRIGRAMS = cfg.get('INDEX_TRIGRAMS', self.INDEX_TRIGRAMS)
        self.INDEX_STEMMING = cfg.get('INDEX_STEMMING', self.INDEX_STEMMING)
        self.USAGE_STATS = cfg.get('USAGE_STATS', self.USAGE_STATS)
        self.LIST_COMPACT = cfg.get('LIST_COMPACT', self.LIST_COMPACT)

        # save any changes
        with open(fn, 'w') as fp:
            b = json.dumps({
                'BASE_PATH': self.BASE_PATH,
                'NOTES_DIR': self.NOTES_DIR,
                'LINK_COLOR': self.LINK_COLOR,
                'ALERT_COLOR': self.ALERT_COLOR,
                'FOCAL_COLOR': self.FOCAL_COLOR,
                'TEXT_COLOR': self.TEXT_COLOR,
                'BACKGROUND_COLOR': self.BACKGROUND_COLOR,
                'HEADER_COLOR': self.HEADER_COLOR,
                'SIDEBAR_COLOR': self.SIDEBAR_COLOR,
                'DEFAULT_NN': self.DEFAULT_NN,
                'HTTP_PORT': self.HTTP_PORT,
                'INDEX_TRIGRAMS': self.INDEX_TRIGRAMS,
                'INDEX_STEMMING': self.INDEX_STEMMING,
                'USAGE_STATS': self.USAGE_STATS,
                'LIST_COMPACT': self.LIST_COMPACT,
            })
            fp.write(b)

    def get_num_notes_per_page(self) -> int:
        return self.DEFAULT_NN

    def get_base_path(self) -> str:
        return self.BASE_PATH

    def get_notes_dir(self) -> str:
        return self.NOTES_DIR

    def get_alert_color(self) -> str:
        return self.ALERT_COLOR

    def get_background_color(self) -> str:
        return self.BACKGROUND_COLOR

    def get_link_color(self) -> str:
        return self.LINK_COLOR

    def get_text_color(self) -> str:
        return self.TEXT_COLOR

    def get_focal_color(self) -> str:
        return self.FOCAL_COLOR

    def get_header_color(self) -> str:
        return self.HEADER_COLOR

    def get_sidebar_color(self) -> str:
        return self.SIDEBAR_COLOR

    def get_http_port(self) -> int:
        return self.HTTP_PORT

    def get_list_compact(self) -> int:
        return self.LIST_COMPACT
