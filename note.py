import os
import datetime

from config import Config


class Note(object):

    def __init__(self, tags: list[str], people: list[str], title: str, timestamp: int, last_edit_time=None, token_count=0):
        self.tags = tags
        self.people = people
        self.title = title
        self.timestamp = timestamp
        self.score = 0.0
        self.last_edit_time = last_edit_time
        self.token_count = token_count

    def to_json(self) -> dict:
        return {'tags': self.tags, 'people': self.people, 'title': self.title, 'timestamp': self.timestamp,
                'last_edit_time': self.last_edit_time, 'token_count': self.token_count}

    def get_file_name(self, cfg: Config) -> str:
        dttm = datetime.datetime.fromtimestamp(self.timestamp)
        y, m, d = str(dttm).split()[0].split('-')
        path = os.path.join(cfg.get_notes_dir(), y, m, d)
        fn = os.path.join(path, "{0}.md".format(self.timestamp))
        return fn

    @staticmethod
    def get_taglines(body: str, tag: str) -> list[str]:
        return [line.strip() for line in body.split('\n') if line.strip().find(tag) > -1]

    def __str__(self):
        return "{0}: {1} ({2}, {3})".format(self.timestamp, self.title, ', '.join(self.tags), ', '.join(self.people))

    def get_last_edit_time(self):
        return self.last_edit_time
