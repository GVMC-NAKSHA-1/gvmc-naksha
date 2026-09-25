import os
import sys

# Worker modules import each other as top-level packages from src/ (see Dockerfile CMD).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
