import os
import tempfile

# keep the module-level app (imported by app.main) out of the working folder
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="betalog-test-"))
