"""Flask server for the CivSim frontend: serves the UI and proxies the FastAPI backend."""
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__, static_folder="templates/static", static_url_path="/static")
BACKEND = "http://localhost:5000"


@app.route("/")
def index():
    """Serve the single-page game view."""
    return render_template("index.html")


@app.route("/api/state")
def state():
    """Proxy the full world state."""
    r = requests.get(f"{BACKEND}/state")
    return jsonify(r.json())


@app.route("/api/turn", methods=["POST"])
def turn():
    """Proxy a turn execution."""
    r = requests.post(f"{BACKEND}/turn")
    return jsonify(r.json())


@app.route("/api/inject", methods=["POST"])
def inject():
    """Proxy an event card injection."""
    r = requests.post(f"{BACKEND}/inject", json=request.json)
    return jsonify(r.json()), r.status_code


@app.route("/api/reset", methods=["POST"])
def reset():
    """Proxy a world reset."""
    r = requests.post(f"{BACKEND}/reset")
    return jsonify(r.json())


@app.route("/api/history")
def history():
    """Proxy the full event history."""
    r = requests.get(f"{BACKEND}/history")
    return jsonify(r.json())


if __name__ == "__main__":
    app.run(port=3000, debug=True)
