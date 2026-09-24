"""
SpeechAi.py — All-in-one: PDF -> Recursive Chunking -> ChromaDB -> Terminal Query

No AI/LLM generation involved here — this is pure chunking + semantic retrieval.
You get back the raw matching chunks and their similarity distance, nothing generated.

Install dependencies first:
    pip install chromadb langchain-text-splitters pypdf sentence-transformers

USAGE
-----
1) Process PDF(s) and store them in ChromaDB:

    python SpeechAi.py store
        -> processes every PDF inside the "documents" folder next to this script

    python SpeechAi.py store "path/to/specific.pdf"
        -> processes just that one PDF

2) Ask questions against what's already stored (no reprocessing):

    python SpeechAi.py ask "ano ang mga skills ni paulo"
        -> one-off question, prints matching chunks

    python SpeechAi.py ask
        -> interactive mode, keep asking until you type 'exit'
"""

import sys
import os
import json
import argparse
from datetime import datetime

from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb
from chromadb.utils import embedding_functions


# ----------------------------------------------------------------------
# Config / paths
# ----------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DOCUMENTS_DIR = os.path.join(SCRIPT_DIR, "documents")
DEFAULT_PERSIST_DIR = os.path.join(SCRIPT_DIR, "chroma_db")
DEFAULT_COLLECTION_NAME = "my_documents"
RAG_LOG_FILE = os.path.join(SCRIPT_DIR, "rag_log.json")


# ----------------------------------------------------------------------
# Shared: embedding function + chromadb client
# ----------------------------------------------------------------------

def get_collection(collection_name, persist_dir, create_if_missing=False):
    client = chromadb.PersistentClient(path=persist_dir)

    # Local embedding model, no API key needed
    embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="all-MiniLM-L6-v2"
    )

    if create_if_missing:
        collection = client.get_or_create_collection(
            name=collection_name,
            embedding_function=embedding_fn,
        )
    else:
        try:
            collection = client.get_collection(name=collection_name, embedding_function=embedding_fn)
        except Exception:
            print(f"❌ Collection '{collection_name}' not found in '{persist_dir}'.")
            print("   Run: python SpeechAi.py store")
            sys.exit(1)

    return collection


# ----------------------------------------------------------------------
# JSON logging for RAG queries
# ----------------------------------------------------------------------

def _load_log():
    """Load existing log entries from rag_log.json, or return an empty list."""
    if os.path.exists(RAG_LOG_FILE):
        try:
            with open(RAG_LOG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []


def _save_log(log_entries):
    """Persist the full log list back to rag_log.json."""
    with open(RAG_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log_entries, f, indent=2, ensure_ascii=False)


def log_query(query, docs, distances, metadatas):
    """Append one query + its retrieved results to the JSON log."""
    results_list = []
    for rank, (doc, dist, meta) in enumerate(zip(docs, distances, metadatas)):
        results_list.append({
            "rank": rank + 1,
            "source": meta.get("source", "unknown"),
            "section": meta.get("section", "unknown"),
            "chunk_index": meta.get("chunk_index"),
            "distance": round(dist, 6),
            "text": doc.strip(),
        })

    entry = {
        "timestamp": datetime.now().isoformat(),
        "query": query,
        "n_results": len(results_list),
        "results": results_list,
    }

    log_entries = _load_log()
    log_entries.append(entry)
    _save_log(log_entries)
    print(f"📝 Logged query to {RAG_LOG_FILE}")


import re


# ----------------------------------------------------------------------
# STORE MODE — extract, chunk, embed, save  (TUNED)
# ----------------------------------------------------------------------

# Known resume section headers (used for section-aware splitting)
SECTION_HEADERS = [
    "PROFESSIONAL SUMMARY",
    "AREAS OF EXPERTISE",
    "PROFESSIONAL EXPERIENCE",
    "EDUCATION",
    "TECHNICAL PROFICIENCIES",
    "LINKS",
    "THESIS PROJECT",
    "ACHIEVEMENTS",
    "CERTIFICATIONS",
    "PROJECTS",
]


def extract_text_from_pdf(pdf_path):
    """Extract text from each page, returning list of (page_num, text) tuples."""
    reader = PdfReader(pdf_path)
    pages = []

    print(f"📄 Reading PDF: {pdf_path}")
    print(f"   Total pages: {len(reader.pages)}\n")

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append((i + 1, text))
        print(f"   Page {i + 1}: extracted {len(text)} characters")

    total = sum(len(t) for _, t in pages)
    print(f"\n✅ Extracted {total} total characters from PDF\n")
    return pages


def clean_text(text):
    """Remove PDF artifacts and unwrap soft line-wraps within sentences."""
    # 1. Strip page footers and headers metadata
    text = re.sub(r"paulotfesalbon12@gmail\.com\s*Page\s*\d+\s*of\s*\d+", "", text)
    # 2. Remove orphaned bullet characters
    text = re.sub(r"(?m)^\s*•\s*$", "", text)

    def is_header(line):
        stripped = line.strip().upper()
        return any(stripped == h or re.sub(r"\s+", " ", stripped) == h for h in SECTION_HEADERS)

    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if cleaned_lines and cleaned_lines[-1] != "":
                cleaned_lines.append("")
            continue

        if is_header(stripped):
            if cleaned_lines and cleaned_lines[-1] != "":
                cleaned_lines.append("")
            cleaned_lines.append(stripped.upper())
            continue

        if cleaned_lines and cleaned_lines[-1] != "":
            prev = cleaned_lines[-1]
            if (not prev.endswith(":") and
                not prev.endswith("•") and
                not prev.endswith("-") and
                not is_header(prev) and
                not stripped.startswith("•") and
                not stripped.startswith("-") and
                not re.match(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})\b", stripped) and
                not re.match(r"^[A-Z][a-zA-Z\s]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})", stripped)):
                cleaned_lines[-1] = prev + " " + stripped
                continue

        cleaned_lines.append(stripped)

    return "\n".join(cleaned_lines)


def section_aware_split(full_text, chunk_size=800, chunk_overlap=120):
    """
    Fine-tuned two-pass chunking:
    1. Splits on major resume section boundaries.
    2. Uses recursive splitting with sentence-aware separators (no mid-sentence cuts).
    """

    def is_header(line):
        stripped = line.strip().upper()
        return any(stripped == h or re.sub(r"\s+", " ", stripped) == h for h in SECTION_HEADERS)

    lines = full_text.split("\n")
    sections = []
    current_label = "CONTACT & PROFILE"
    current_lines = []

    for line in lines:
        if is_header(line):
            if current_lines:
                sec_text = "\n".join(current_lines).strip()
                if sec_text and len(sec_text) > 30:
                    sections.append((sec_text, current_label))
            current_label = line.strip().upper()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sec_text = "\n".join(current_lines).strip()
        if sec_text and len(sec_text) > 30:
            sections.append((sec_text, current_label))

    # Sentence-aware recursive splitter:
    # Prioritizes: Paragraphs (\n\n) -> Bullets (\n•, \n-) -> Sentences (. , ? , ! ) -> Words
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n• ", "\n- ", ". ", "? ", "! ", " ", ""],
    )

    result = []
    for sec_text, label in sections:
        if len(sec_text) <= chunk_size:
            result.append((sec_text, label))
        else:
            sub_chunks = splitter.split_text(sec_text)
            for sc in sub_chunks:
                sc_clean = sc.strip()
                if len(sc_clean) < 30:
                    continue
                # Add contextual section header tag if missing
                if not sc_clean.startswith(label) and label not in ("CONTACT & PROFILE", "HEADER"):
                    result.append((f"[{label}]\n{sc_clean}", label))
                else:
                    result.append((sc_clean, label))

    return result


def print_chunks(chunks_with_labels):
    print("=" * 70)
    print(f"CHUNKING RESULTS — {len(chunks_with_labels)} chunks created")
    print("=" * 70)
    for i, (chunk, label) in enumerate(chunks_with_labels):
        print(f"\n--- Chunk {i} [{label}] (length={len(chunk)} chars) ---")
        preview = chunk.strip().replace("\n", " ")
        print(preview[:300] + ("..." if len(preview) > 300 else ""))
    print("\n" + "=" * 70 + "\n")


def store_chunks_in_chromadb(chunks_with_labels, collection_name, persist_dir, source_filename):
    print(f"💾 Connecting to ChromaDB (persisted at: {persist_dir})")

    # Delete old collection to avoid stale/duplicate data
    client = chromadb.PersistentClient(path=persist_dir)
    try:
        client.delete_collection(name=collection_name)
        print(f"🗑️  Deleted old collection '{collection_name}' for fresh re-index")
    except Exception:
        pass

    collection = get_collection(collection_name, persist_dir, create_if_missing=True)

    documents = []
    ids = []
    metadatas = []

    for i, (chunk, label) in enumerate(chunks_with_labels):
        documents.append(chunk)
        ids.append(f"{source_filename}-chunk-{i}")
        metadatas.append({
            "source": source_filename,
            "chunk_index": i,
            "section": label,
        })

    print(f"🧠 Embedding and storing {len(documents)} chunks into collection '{collection_name}'...")
    collection.add(documents=documents, ids=ids, metadatas=metadatas)

    print(f"✅ Stored {collection.count()} total chunks in collection '{collection_name}'\n")
    return collection


def process_single_pdf(pdf_path, chunk_size, chunk_overlap, collection_name, persist_dir):
    print(f"\n{'#' * 70}")
    print(f"# Processing: {os.path.basename(pdf_path)}")
    print(f"{'#' * 70}\n")

    pages = extract_text_from_pdf(pdf_path)
    full_text = "\n\n".join(text for _, text in pages)

    if not full_text.strip():
        print(f"⚠️  Skipping {pdf_path} — no extractable text (it may be scanned/image-based).")
        return None

    # Clean PDF artifacts
    cleaned = clean_text(full_text)
    print(f"🧹 Cleaned text: {len(full_text)} -> {len(cleaned)} chars (removed {len(full_text) - len(cleaned)} artifact chars)\n")

    # Section-aware chunking
    chunks_with_labels = section_aware_split(cleaned, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    print_chunks(chunks_with_labels)

    source_filename = os.path.basename(pdf_path)
    return store_chunks_in_chromadb(chunks_with_labels, collection_name, persist_dir, source_filename)


def run_store(args):
    if args.pdf_path:
        if not os.path.exists(args.pdf_path):
            print(f"❌ File not found: {args.pdf_path}")
            sys.exit(1)
        pdf_paths = [args.pdf_path]
    else:
        if not os.path.isdir(DEFAULT_DOCUMENTS_DIR):
            os.makedirs(DEFAULT_DOCUMENTS_DIR, exist_ok=True)
            print(f"📁 Created default documents folder: {DEFAULT_DOCUMENTS_DIR}")
            print("   Drop your PDF(s) in there and run this again.")
            sys.exit(0)

        pdf_paths = [
            os.path.join(DEFAULT_DOCUMENTS_DIR, f)
            for f in os.listdir(DEFAULT_DOCUMENTS_DIR)
            if f.lower().endswith(".pdf")
        ]

        if not pdf_paths:
            print(f"❌ No PDF files found in: {DEFAULT_DOCUMENTS_DIR}")
            print("   Drop a .pdf file in there and run this again.")
            sys.exit(1)

        print(f"📁 Found {len(pdf_paths)} PDF(s) in default folder: {DEFAULT_DOCUMENTS_DIR}")
        for p in pdf_paths:
            print(f"   - {os.path.basename(p)}")

    for pdf_path in pdf_paths:
        process_single_pdf(
            pdf_path,
            chunk_size=args.chunk_size,
            chunk_overlap=args.chunk_overlap,
            collection_name=args.collection,
            persist_dir=args.persist_dir,
        )

    print("✅ Done storing. Now you can run: python SpeechAi.py ask")


# ----------------------------------------------------------------------
# ASK MODE — pure retrieval, no AI generation
# ----------------------------------------------------------------------

def run_search(collection, query, n_results=3):
    results = collection.query(query_texts=[query], n_results=n_results)

    docs = results["documents"][0]
    distances = results["distances"][0]
    metadatas = results["metadatas"][0]

    if not docs:
        print("No results found.")
        return

    # Log query + retrieved results to JSON
    log_query(query, docs, distances, metadatas)

    print(f"\n🔎 Results for: \"{query}\"\n" + "-" * 60)
    for rank, (doc, dist, meta) in enumerate(zip(docs, distances, metadatas)):
        section = meta.get('section', '?')
        print(f"\n#{rank + 1}  [section: {section}]  (source: {meta.get('source')}, distance: {dist:.4f})")
        print(doc.strip())
    print("\n" + "-" * 60)


def run_ask(args):
    collection = get_collection(args.collection, args.persist_dir, create_if_missing=False)
    print(f"✅ Loaded collection '{args.collection}' ({collection.count()} chunks stored)\n")

    if args.question:
        run_search(collection, args.question, n_results=args.n_results)
    else:
        print("Type your question and press Enter. Type 'exit' to quit.\n")
        while True:
            query = input("❓ Your question: ").strip()
            if query.lower() in ("exit", "quit"):
                print("Bye!")
                break
            if not query:
                continue
            run_search(collection, query, n_results=args.n_results)


# ----------------------------------------------------------------------
# CLI entry point
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Chunk PDFs into ChromaDB, then query them from the terminal (no AI generation)."
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)

    # --- store mode ---
    store_parser = subparsers.add_parser("store", help="Chunk PDF(s) and store them in ChromaDB")
    store_parser.add_argument(
        "pdf_path",
        nargs="?",
        default=None,
        help=f"Specific PDF to process. If omitted, processes every PDF in {DEFAULT_DOCUMENTS_DIR}",
    )
    store_parser.add_argument("--chunk-size", type=int, default=800)
    store_parser.add_argument("--chunk-overlap", type=int, default=150)
    store_parser.add_argument("--collection", default=DEFAULT_COLLECTION_NAME)
    store_parser.add_argument("--persist-dir", default=DEFAULT_PERSIST_DIR)

    # --- ask mode ---
    ask_parser = subparsers.add_parser("ask", help="Query the stored chunks (retrieval only, no AI)")
    ask_parser.add_argument("question", nargs="?", default=None, help="Your question (omit for interactive mode)")
    ask_parser.add_argument("--collection", default=DEFAULT_COLLECTION_NAME)
    ask_parser.add_argument("--persist-dir", default=DEFAULT_PERSIST_DIR)
    ask_parser.add_argument("--n-results", type=int, default=5)

    args = parser.parse_args()

    if args.mode == "store":
        run_store(args)
    elif args.mode == "ask":
        run_ask(args)


if __name__ == "__main__":
    main()