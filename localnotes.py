from config import Config
from flask_server import run_app


if __name__ == '__main__':
    cfg = Config()
    cfg.load()
    run_app(cfg)
