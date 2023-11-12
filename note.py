import os
import datetime

from config import Config


class Note(object):

    def __init__(self, tags: list[str], people: list[str], tag_mentions: list[str], people_mentions: list[str],
                 title: str, timestamp: int, last_edit_time=None, token_count=0):
        self.__tags = tags
        self.__people = people
        self.__tag_mentions = tag_mentions
        self.__people_mentions = people_mentions
        self.title = title
        self.timestamp = timestamp
        self.score = 0.0
        self.last_edit_time = last_edit_time
        self.token_count = token_count
        self.__combined_tags = sorted(set((self.__tags or []) + (self.__tag_mentions or []))) or None
        self.__combined_people = sorted(set((self.__people or []) + (self.__people_mentions or []))) or None

    def to_json(self) -> dict:
        return {'tags': self.__tags, 'people': self.__people,
                'tag_mentions': self.__tag_mentions, 'people_mentions': self.__people_mentions,
                'title': self.title, 'timestamp': self.timestamp,
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

    def get_tags(self, include_mentions: bool):
        if include_mentions:
            return self.__combined_tags or []
        else:
            return self.__tags or []

    def get_tag_mentions(self):
        return self.__tag_mentions or []

    def get_people(self, include_mentions: bool):
        if include_mentions:
            return self.__combined_people or []
        else:
            return self.__people or []

    def get_people_mentions(self):
        return self.__people_mentions or []

    def __str__(self):
        return "{0}: {1} ({2}, {3})".format(self.timestamp, self.title, ', '.join(self.get_tags(True)), ', '.join(self.get_people(True)))

    def get_last_edit_time(self):
        return self.last_edit_time
