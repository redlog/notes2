import os
import json
import pathlib


class Config(object):

    def __init__(self):
        # defaults
        self.DEFAULT_BASE_PATH = os.path.join(pathlib.Path.home(), 'localnotes')
        self.DEFAULT_NN = 25
        self.HTTP_PORT = 80
        self.USAGE_STATS = 0
        self.ACTIVE_PROJECT = None
        self.PROJECT_LIST = []

        self.active_notes_dir = None

    @staticmethod
    def get_config_file_name() -> str:
        return os.path.join(Config.get_config_file_path(), "config.json")

    @staticmethod
    def get_config_file_path() -> str:
        return os.path.join(pathlib.Path.home(), 'localnotes')

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
        self.DEFAULT_NN = cfg.get('DEFAULT_NN', self.DEFAULT_NN)
        self.HTTP_PORT = cfg.get('HTTP_PORT', self.HTTP_PORT)
        self.USAGE_STATS = cfg.get('USAGE_STATS', self.USAGE_STATS)
        self.ACTIVE_PROJECT = cfg.get('ACTIVE_PROJECT', None)

        self.PROJECT_LIST = []
        project_list = cfg.get("PROJECT_LIST", [])
        for pl in project_list:
            try:
                name = pl['PROJECT_NAME']
                path = pl['PROJECT_PATH']
                d = {'PROJECT_NAME': name, 'PROJECT_PATH': path}
                self.PROJECT_LIST.append(d)
            except KeyError:
                pass
        if len(self.PROJECT_LIST) == 0:
            self.PROJECT_LIST = [
                {'PROJECT_NAME': 'default_project',
                 'PROJECT_PATH': os.path.join(self.DEFAULT_BASE_PATH, "default_project")
                 }
            ]
            self.ACTIVE_PROJECT = "default_project"

        project_names = [d['PROJECT_NAME'] for d in self.PROJECT_LIST]
        if self.ACTIVE_PROJECT is None or self.ACTIVE_PROJECT not in project_names:
            self.ACTIVE_PROJECT = self.PROJECT_LIST[0]['PROJECT_NAME']

        for pl in self.PROJECT_LIST:
            if pl['PROJECT_NAME'] == self.ACTIVE_PROJECT:
                self.active_notes_dir = pl['PROJECT_PATH']
                break

        # save any changes
        self.save_config_file()

    def save_config_file(self):
        fn = self.get_config_file_name()
        try:
            os.makedirs(Config.get_config_file_path())
        except FileExistsError:
            pass
        with open(fn, 'w') as fp:
            b = json.dumps({
                'DEFAULT_NN': self.DEFAULT_NN,
                'HTTP_PORT': self.HTTP_PORT,
                'USAGE_STATS': self.USAGE_STATS,
                'ACTIVE_PROJECT': self.ACTIVE_PROJECT,
                'PROJECT_LIST': self.PROJECT_LIST
            })
            fp.write(b)

    def set_active_project(self, project_name) -> bool:
        for pl in self.PROJECT_LIST:
            if project_name == pl['PROJECT_NAME']:
                self.ACTIVE_PROJECT = pl['PROJECT_NAME']
                self.active_notes_dir = pl['PROJECT_PATH']
                self.save_config_file()
                return True
        return False  # not ok - we didn't find that project name in the list

    def get_num_notes_per_page(self) -> int:
        return self.DEFAULT_NN

    def get_notes_dir(self) -> str:
        return self.active_notes_dir

    def get_http_port(self) -> int:
        return self.HTTP_PORT

    def get_active_project_name(self) -> str:
        return self.ACTIVE_PROJECT

    def get_project_list(self) -> list[str]:
        return [d['PROJECT_NAME'] for d in self.PROJECT_LIST]
