#!/usr/bin/env python3
"""Group the B2 poster thumbnails by visual style and write a JSON database.

Pipeline (CLIP-hybrid — no paid API, images are only ever read, never copied in B2):

  1. cluster phase   `python scripts/tag-styles.py cluster`
       - list every {name}.jpg poster in the B2 bucket
       - CLIP-embed each one locally (cached, so re-runs only touch new posters)
       - HDBSCAN clusters the embeddings ("let the data decide")
       - download a few representative thumbnails per cluster into
         scripts/.cache/representatives/cluster_N/ and write a draft JSON

  2. (human/Claude step) look at the representatives and write a label per
       cluster into scripts/.cache/cluster-labels.json, e.g.
         { "0": {"style": "loose impasto", "description": "..."}, ... }

  3. apply phase     `python scripts/tag-styles.py apply`
       - merge the labels into the final database at src/data/clip-styles.json

Bonus, fully automatic (no Claude at all):
  `python scripts/tag-styles.py zeroshot --vocab "impasto,fine detail,loose,monochrome,..."`
       - CLIP scores each image against your style words and writes the database
         directly. Free and hands-off, but coarser than the cluster+label flow.

B2 credentials come from .env.local (same vars as normalize-b2.mjs):
  B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT, B2_REGION
"""

import argparse
import io
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
EMB_FILE = CACHE / "embeddings.npz"
REPS_DIR = CACHE / "representatives"
DRAFT_FILE = CACHE / "clusters-draft.json"
LABELS_FILE = CACHE / "cluster-labels.json"
OUT_FILE = ROOT / "src" / "data" / "clip-styles.json"
ORDER_FILE = ROOT / "src" / "data" / "clip-order.json"

CLIP_ARCH = "ViT-B-32"
CLIP_PRETRAINED = "laion2b_s34b_b79k"
MODEL_TAG = f"{CLIP_ARCH}/{CLIP_PRETRAINED}"

POSTER_RE = re.compile(r"^(\d+)\.jpg$", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# env + B2
# --------------------------------------------------------------------------- #
def load_env() -> None:
    """Minimal .env loader; .env.local wins over .env (mirrors normalize-b2.mjs)."""
    for fname in (".env.local", ".env"):
        p = ROOT / fname
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip("\"'")


def b2_client():
    import boto3

    missing = [k for k in ("B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "B2_REGION")
               if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing env vars: {', '.join(missing)} — add them to .env.local (see .env.example).")
    return boto3.client(
        "s3",
        endpoint_url=os.environ["B2_ENDPOINT"],
        region_name=os.environ["B2_REGION"],
        aws_access_key_id=os.environ["B2_KEY_ID"],
        aws_secret_access_key=os.environ["B2_APP_KEY"],
    )


def list_posters(client) -> list[str]:
    """Return sorted poster names (the {name} of every {name}.jpg in the bucket)."""
    bucket = os.environ["B2_BUCKET"]
    names, token = [], None
    while True:
        kw = {"Bucket": bucket}
        if token:
            kw["ContinuationToken"] = token
        res = client.list_objects_v2(**kw)
        for obj in res.get("Contents", []):
            m = POSTER_RE.match(obj["Key"])
            if m:
                names.append(m.group(1))
        if res.get("IsTruncated"):
            token = res.get("NextContinuationToken")
        else:
            break
    return sorted(set(names), key=int)


def fetch_jpg(client, name: str) -> bytes:
    obj = client.get_object(Bucket=os.environ["B2_BUCKET"], Key=f"{name}.jpg")
    return obj["Body"].read()


# --------------------------------------------------------------------------- #
# CLIP embeddings (cached, incremental)
# --------------------------------------------------------------------------- #
def pick_device():
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_cache() -> dict:
    import numpy as np

    if not EMB_FILE.exists():
        return {}
    data = np.load(EMB_FILE)
    return {k: data[k] for k in data.files}


def save_cache(emb: dict) -> None:
    import numpy as np

    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(EMB_FILE, **emb)


def embed_all(client, names: list[str], force: bool = False) -> dict:
    """Embed every poster, reusing cached vectors. Returns {name: vec(float32)}."""
    import numpy as np
    import open_clip
    import torch
    from PIL import Image

    emb = {} if force else load_cache()
    todo = [n for n in names if n not in emb]
    if not todo:
        print(f"All {len(names)} posters already embedded (cache hit).")
        return {n: emb[n] for n in names}

    device = pick_device()
    print(f"Embedding {len(todo)} new poster(s) on {device} with {MODEL_TAG} "
          f"({len(emb)} cached)...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        CLIP_ARCH, pretrained=CLIP_PRETRAINED)
    model.eval().to(device)

    for i, name in enumerate(todo, 1):
        try:
            img = Image.open(io.BytesIO(fetch_jpg(client, name))).convert("RGB")
            x = preprocess(img).unsqueeze(0).to(device)
            with torch.no_grad():
                feat = model.encode_image(x)
                feat = feat / feat.norm(dim=-1, keepdim=True)
            emb[name] = feat.cpu().numpy()[0].astype("float32")
        except Exception as e:  # noqa: BLE001 — keep going on a bad poster
            print(f"  ! {name}.jpg failed: {e}")
        if i % 25 == 0 or i == len(todo):
            print(f"  embedded {i}/{len(todo)}")
            save_cache(emb)  # checkpoint so a crash doesn't lose progress

    save_cache(emb)
    return {n: emb[n] for n in names if n in emb}


# --------------------------------------------------------------------------- #
# cluster phase
# --------------------------------------------------------------------------- #
def representatives(names, X, labels, cluster_id, k):
    """k member names whose embeddings are closest to the cluster medoid."""
    import numpy as np

    idx = [i for i, lab in enumerate(labels) if lab == cluster_id]
    sub = X[idx]
    sims = sub @ sub.T              # cosine sim (X rows are L2-normalized)
    medoid = idx[int(sims.mean(axis=1).argmax())]
    order = np.argsort(-(X[idx] @ X[medoid]))
    return [names[idx[j]] for j in order[:k]]


def reduce_dims(X, n_components, seed=0):
    """Reduce embeddings before HDBSCAN. UMAP (cosine) preserves the local
    density structure HDBSCAN needs; PCA is a fallback if UMAP isn't installed.
    Raw 512-dim CLIP vectors make HDBSCAN call almost everything noise."""
    try:
        import umap

        n_components = min(n_components, X.shape[0] - 2)
        reducer = umap.UMAP(n_neighbors=15, n_components=n_components,
                            metric="cosine", random_state=seed)
        print(f"Reducing {X.shape[1]}D -> {n_components}D with UMAP (cosine)...")
        return reducer.fit_transform(X)
    except ImportError:
        from sklearn.decomposition import PCA

        n_components = min(50, X.shape[0] - 1, X.shape[1])
        print(f"UMAP not installed; falling back to PCA -> {n_components}D "
              "(clustering may be noisier).")
        return PCA(n_components=n_components, random_state=seed).fit_transform(X)


def cmd_cluster(args):
    import numpy as np
    import hdbscan

    load_env()
    client = b2_client()
    names = list_posters(client)
    print(f"Found {len(names)} poster thumbnails in bucket {os.environ['B2_BUCKET']}.")
    if not names:
        sys.exit("No {name}.jpg posters found — nothing to cluster.")

    emb = embed_all(client, names, force=args.force_embed)
    names = [n for n in names if n in emb]
    X = np.stack([emb[n] for n in names])  # (N, 512), L2-normalized

    Xr = reduce_dims(X, args.dims)
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=args.min_cluster_size,
        min_samples=args.min_samples,
        metric="euclidean",
        cluster_selection_method=args.selection,
    )
    labels = clusterer.fit_predict(Xr)

    ids = sorted(set(int(l) for l in labels))
    n_noise = int((labels == -1).sum())
    print(f"HDBSCAN: {len([i for i in ids if i >= 0])} style cluster(s), "
          f"{n_noise} unsorted/outlier image(s).")

    # Export representatives + draft JSON.
    if REPS_DIR.exists():
        shutil.rmtree(REPS_DIR)
    REPS_DIR.mkdir(parents=True, exist_ok=True)

    clusters = []
    for cid in ids:
        members = [names[i] for i, l in enumerate(labels) if l == cid]
        reps = representatives(names, X, labels, cid, args.reps)
        folder = REPS_DIR / (f"cluster_{cid}" if cid >= 0 else "unsorted")
        folder.mkdir(parents=True, exist_ok=True)
        for n in reps:
            (folder / f"{n}.jpg").write_bytes(fetch_jpg(client, n))
        clusters.append({
            "id": cid,
            "count": len(members),
            "representatives": [f"{n}.jpg" for n in reps],
            "style": "unsorted" if cid == -1 else None,
            "description": None,
        })
        tag = "unsorted" if cid == -1 else f"cluster {cid}"
        print(f"  {tag}: {len(members)} image(s) -> reps in {folder.relative_to(ROOT)}")

    draft = {
        "model": MODEL_TAG,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "clusters": clusters,
        "images": [
            {"name": names[i], "file": f"{names[i]}.jpg", "cluster": int(labels[i])}
            for i in range(len(names))
        ],
    }
    DRAFT_FILE.write_text(json.dumps(draft, indent=2) + "\n")
    print(f"\nDraft written to {DRAFT_FILE.relative_to(ROOT)}.")
    print("Next: review the representative thumbnails, then write labels to "
          f"{LABELS_FILE.relative_to(ROOT)} and run `tag-styles.py apply`.")


# --------------------------------------------------------------------------- #
# apply phase
# --------------------------------------------------------------------------- #
def cmd_apply(args):
    if not DRAFT_FILE.exists():
        sys.exit("No draft found — run `tag-styles.py cluster` first.")
    if not LABELS_FILE.exists():
        sys.exit(f"No labels found — write cluster labels to "
                 f"{LABELS_FILE.relative_to(ROOT)} first.")

    draft = json.loads(DRAFT_FILE.read_text())
    labels = json.loads(LABELS_FILE.read_text())  # {"<cluster id>": {style, description}}

    def style_for(cid):
        if cid == -1:
            return ("unsorted", "Outliers that didn't fall into any style cluster.")
        lab = labels.get(str(cid)) or {}
        return (lab.get("style"), lab.get("description"))

    clusters_out = []
    for c in draft["clusters"]:
        style, desc = style_for(c["id"])
        clusters_out.append({"id": c["id"], "style": style,
                             "description": desc, "count": c["count"]})

    by_id = {c["id"]: c["style"] for c in clusters_out}
    images_out = [{"name": im["name"], "file": im["file"], "cluster": im["cluster"],
                   "style": by_id.get(im["cluster"])} for im in draft["images"]]

    missing = sorted({c["id"] for c in clusters_out
                      if c["id"] >= 0 and not c["style"]})
    if missing:
        print(f"  ! no label for cluster(s) {missing} — their images will have style=null.")

    out = {"model": draft["model"], "generated": draft["generated"],
           "clusters": clusters_out, "images": images_out}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {len(images_out)} tagged images across "
          f"{len([c for c in clusters_out if c['id'] >= 0])} styles to "
          f"{OUT_FILE.relative_to(ROOT)}.")


# --------------------------------------------------------------------------- #
# arrange — order clips so the grid places visually-similar clips as neighbors
# --------------------------------------------------------------------------- #
def cmd_arrange(args):
    """Produce a 1-D ordering of all posters such that, when the app lays the
    array out row-major over a `cols`-wide grid, both horizontal and vertical
    neighbours look alike. Standard "grid-UMAP": project embeddings to 2-D, then
    assign each image to a unique lattice cell via optimal linear assignment."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    load_env()
    client = b2_client()
    names = list_posters(client)
    emb = embed_all(client, names, force=args.force_embed)
    names = [n for n in names if n in emb]
    X = np.stack([emb[n] for n in names])  # (N, 512), L2-normalized
    n = len(names)

    # 2-D UMAP (cosine), normalized to the unit square.
    xy = reduce_dims(X, 2)
    xy = (xy - xy.min(axis=0)) / np.ptp(xy, axis=0).clip(1e-9)

    # Lattice matching the app grid: `cols` wide, enough rows to hold every image.
    cols = args.cols
    rows = int(np.ceil(n / cols))
    gx, gy = np.meshgrid(np.arange(cols), np.arange(rows))
    cells = np.column_stack([gx.ravel(), gy.ravel()]).astype(float)  # (rows*cols, 2)
    cells_norm = cells / np.array([max(cols - 1, 1), max(rows - 1, 1)])

    # Cost = squared distance from each image's 2-D point to each lattice cell.
    # linear_sum_assignment handles the rectangular case (more cells than images).
    print(f"Assigning {n} images to a {cols}x{rows} lattice (optimal transport)...")
    cost = np.sum((xy[:, None, :] - cells_norm[None, :, :]) ** 2, axis=2)
    img_idx, cell_idx = linear_sum_assignment(cost)

    # Emit names in row-major cell order so order[row*cols + col] is the grid cell.
    cell_to_name = {int(c): names[int(i)] for i, c in zip(img_idx, cell_idx)}
    order = [cell_to_name[c] for c in sorted(cell_to_name)]

    ORDER_FILE.parent.mkdir(parents=True, exist_ok=True)
    ORDER_FILE.write_text(json.dumps(
        {"model": MODEL_TAG,
         "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "cols": cols, "order": order}, indent=2) + "\n")
    print(f"Wrote similarity ordering of {len(order)} clips (cols={cols}) to "
          f"{ORDER_FILE.relative_to(ROOT)}.")


# --------------------------------------------------------------------------- #
# zero-shot (no Claude) — optional fully-automatic path
# --------------------------------------------------------------------------- #
def cmd_zeroshot(args):
    import numpy as np
    import open_clip
    import torch

    vocab = [v.strip() for v in args.vocab.split(",") if v.strip()]
    if len(vocab) < 2:
        sys.exit("Pass at least two style words via --vocab \"a,b,c\".")

    load_env()
    client = b2_client()
    names = list_posters(client)
    emb = embed_all(client, names, force=args.force_embed)
    names = [n for n in names if n in emb]
    X = np.stack([emb[n] for n in names])

    device = pick_device()
    model, _, _ = open_clip.create_model_and_transforms(CLIP_ARCH, pretrained=CLIP_PRETRAINED)
    model.eval().to(device)
    tokenizer = open_clip.get_tokenizer(CLIP_ARCH)
    prompts = [f"a painting in a {v} style" for v in vocab]
    with torch.no_grad():
        tfeat = model.encode_text(tokenizer(prompts).to(device))
        tfeat = (tfeat / tfeat.norm(dim=-1, keepdim=True)).cpu().numpy()

    scores = X @ tfeat.T                 # (N, vocab)
    best = scores.argmax(axis=1)
    images = [{"name": names[i], "file": f"{names[i]}.jpg",
               "style": vocab[best[i]], "score": round(float(scores[i, best[i]]), 4)}
              for i in range(len(names))]
    counts = {v: int((best == j).sum()) for j, v in enumerate(vocab)}
    out = {"model": MODEL_TAG, "method": "zero-shot",
           "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "vocabulary": vocab, "counts": counts, "images": images}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Zero-shot tagged {len(images)} images -> {OUT_FILE.relative_to(ROOT)}")
    for v in vocab:
        print(f"  {counts[v]:>4}  {v}")


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("cluster", help="embed + HDBSCAN cluster + export representatives")
    c.add_argument("--min-cluster-size", type=int, default=8,
                   help="smallest group HDBSCAN treats as a cluster (default 8)")
    c.add_argument("--min-samples", type=int, default=1,
                   help="HDBSCAN conservativeness; lower = fewer 'unsorted' (default 1)")
    c.add_argument("--dims", type=int, default=5,
                   help="UMAP target dimensionality before clustering (default 5)")
    c.add_argument("--selection", choices=("eom", "leaf"), default="eom",
                   help="HDBSCAN cluster selection; 'leaf' gives more, finer clusters")
    c.add_argument("--reps", type=int, default=6,
                   help="representative thumbnails to export per cluster (default 6)")
    c.add_argument("--force-embed", action="store_true",
                   help="re-embed everything, ignoring the cache")
    c.set_defaults(func=cmd_cluster)

    a = sub.add_parser("apply", help="merge cluster-labels.json into the final database")
    a.set_defaults(func=cmd_apply)

    ar = sub.add_parser("arrange",
                        help="order clips so the grid groups similar clips as neighbors")
    ar.add_argument("--cols", type=int, default=20,
                    help="grid columns; must match GRID_COLS in src/theme.ts (default 20)")
    ar.add_argument("--force-embed", action="store_true",
                    help="re-embed everything, ignoring the cache")
    ar.set_defaults(func=cmd_arrange)

    z = sub.add_parser("zeroshot", help="fully-automatic CLIP labeling against a fixed vocab")
    z.add_argument("--vocab", required=True, help='comma-separated style words')
    z.add_argument("--force-embed", action="store_true")
    z.set_defaults(func=cmd_zeroshot)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
