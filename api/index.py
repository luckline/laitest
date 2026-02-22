from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/api/test", methods=["GET"])
def test():
    return jsonify({"status": "success", "message": "Python 后端已连接到 laitest.tech"})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


# 这一行在 Vercel 部署时可作为显式入口保留
def handler(request):
    return app(request)

