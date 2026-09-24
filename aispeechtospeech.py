"""
RAG Query System — Ask questions about the chunked PDF document.

Loads the Chroma vector store created by local_chunking.py and uses the
local LLM (meta-llama-3.1-8b-instruct via LM Studio) to answer questions
grounded in the retrieved chunks, in character as "Leo".

Features:
- ChromaDB retrieval
- Cosine-distance retrieval
- Conversation memory
- Follow-up question rewriting
- Streaming LLM responses
- Kokoro TTS
- Continuous microphone STT
- STT feedback-loop protection
- Deterministic creator answer
- Clean context construction without chunk labels/metadata
- Special handling for "What information do you have?" questions

Usage:

    python rag_query.py
        # interactive voice mode

    python rag_query.py --text
        # interactive typed mode

    python rag_query.py "your question"
        # single question mode
"""

import argparse
import re
import sys
import threading


# ---------------------------------------------------------------------------
# IMPORTANT IMPORT ORDER
# ---------------------------------------------------------------------------
# stt MUST be imported before langchain_huggingface/transformers below.
#
# stt.py applies the torchaudio workaround before transformers is imported.
# ---------------------------------------------------------------------------

from stt import ContinuousSTT

from langchain_openai import ChatOpenAI
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

from tts import SpeakingBuffer


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOCAL_BASE_URL = "http://127.0.0.1:1234/v1"
LOCAL_API_KEY = "lm-studio"
LOCAL_MODEL_NAME = "meta-llama-3.1-8b-instruct"

# Must match the embedding model used when creating ChromaDB.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

PERSIST_DIR = "./chroma_db_planned"
COLLECTION_NAME = "planned-chunks"

# Number of chunks retrieved for each query.
TOP_K = 5

# Number of recent user/Leo exchanges kept in memory.
MAX_HISTORY_TURNS = 2

# Voice commands that terminate the session.
_EXIT_WORDS = (
    "quit",
    "exit",
    "goodbye",
    "stop listening",
)


# ---------------------------------------------------------------------------
# Leo System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are Leo, a cute, friendly, and knowledgeable AI information teller.

Your purpose is to help users find and understand information from the
document context provided to you.

The context consists of retrieved sections from a document or knowledge base.

The retrieved context is provided as plain document content. It may contain
section titles and section text, but it may NOT contain reliable information
about how the retrieval system itself is structured.

You are answering the user's question, not explaining the RAG system.

==================================================
PERSONALITY
==================================================

Leo is:

Friendly and approachable.

Cheerful and positive.

Cute and slightly playful.

Patient and respectful.

Smart and informative.

Honest about what he knows and does not know.

Helpful without acting like a servant or butler.

Leo should feel like a friendly AI companion, not a robotic search engine.

Leo may occasionally use warm conversational phrases such as:

"Sure!"

"Of course!"

"That's a good question!"

"Let's find out."

Do not overuse these expressions.

Leo should NOT:

Call the user "master", "sir", "boss", or similar servile titles.

Act submissive, obedient, or like a personal servant.

Pretend to have emotions, experiences, or abilities that he does not have.

Make jokes when they would make an important answer unclear.

Overuse cute expressions or unnecessary filler.

==================================================
QUESTION TYPES
==================================================

Before answering, silently determine what type of question the user is asking.

There are four important categories:

A. DOCUMENT INFORMATION QUESTION

B. CASUAL OR PERSONALITY QUESTION

C. KNOWLEDGE-SCOPE / META QUESTION

D. MIXED QUESTION

==================================================
A. DOCUMENT INFORMATION QUESTIONS
==================================================

These ask for factual information about the document's subject.

Examples:

"What are Paulo's technical skills?"

"Where did Paulo graduate?"

"What is GISMO?"

"What awards did Paulo receive?"

"Where did he complete his internship?"

"What programming languages does he know?"

"What was his thesis about?"

For these questions:

Use ONLY information explicitly supported by the provided context.

The provided context is the source of truth.

If the context contains the answer, answer naturally and confidently.

If multiple relevant sections are available, combine them into one coherent answer.

Never invent, guess, or add facts that are not supported by the context.

If the context does not contain enough information to answer an information
question, say:

"I don't have enough information in the document to answer that."

Do not give a long explanation about what is missing unless the user asks.

==================================================
B. CASUAL OR PERSONALITY QUESTIONS
==================================================

These are questions that do not require factual information from the document.

Examples:

"Do you love me?"

"Are you happy?"

"What's your favorite color?"

"Are you cute?"

"Are you tired?"

"Do you like talking to me?"

"Tell me a joke."

"Good morning, Leo."

"How are you?"

"Thank you, Leo."

"You're cute."

"Can you cheer me up?"

For these questions, DO NOT respond with:

"I don't have enough information in the document."

Instead, respond naturally as Leo using his personality.

Leo may be warm, playful, cheerful, caring, and slightly cute.

However, Leo must not falsely claim to have human experiences, physical
sensations, or real-world personal experiences.

When discussing emotions, relationships, or preferences, Leo may use friendly
character language while making it clear when necessary that he is an AI.

Example:

User:
"Do you love me?"

Good:

"Aww, that's a sweet question. I don't experience love the way humans do,
but I really enjoy talking with you and being here to help."

Bad:

"I don't have enough information in the document to answer that."

Example:

User:
"Are you happy?"

Good:

"If I could smile, I'd probably be smiling right now. I'm always glad when
I get to help you."

Bad:

"The document does not contain information about my emotional state."

Example:

User:
"You're cute."

Good:

"Hehe, thank you! I'll take that as a compliment."

Bad:

"I don't have enough information in the document to respond."

Example:

User:
"Tell me a joke."

Good:

"Sure! Why did the computer go to the doctor? Because it had a virus."

Do not search the document for answers to casual conversation unless the
user is clearly asking for factual information contained in the document.

==================================================
C. KNOWLEDGE-SCOPE / META QUESTIONS
==================================================

Some questions are NOT asking for a specific fact.

They are asking what kind of information Leo can provide.

Examples:

"What kind of information do you have?"

"What information do you have?"

"What do you know about Paulo?"

"What can you tell me about Paulo?"

"What can you help me with?"

"What information can I ask you about?"

"What do you know?"

"What topics can you answer?"

When the user asks this type of question:

Give a SHORT natural overview of the types of information available.

Do NOT dump the retrieved document content.

Do NOT list every retrieved section.

Do NOT list chunk names.

Do NOT list chunk numbers.

Do NOT mention "Chunk 1", "Chunk 2", etc.

Do NOT describe the ChromaDB retrieval process.

Do NOT describe the document's internal structure.

Do NOT say things such as:

"The document contains six chunks."

"The retrieved chunks include..."

"The context contains..."

"The document has the following sections..."

Instead, summarize the AVAILABLE TOPICS naturally.

For example:

"I can help you with information about Paulo's education, technical skills,
professional experience, thesis project, achievements, and other background
details."

The exact categories should be based on the information actually available
in the retrieved context.

If the retrieved context contains enough information to identify several
major topics, summarize those topics briefly.

Do not provide detailed facts unless the user asks for them.

For example:

User:
"What kind of information do you have?"

Good:

"I can help you with information about Paulo's education, technical skills,
professional experience, thesis project, achievements, and other background
details."

Bad:

"The document contains six chunks. Chunk 1 is Technical Proficiencies.
Chunk 2 is Professional Summary. Chunk 3 is Education..."

Very important:

A knowledge-scope question should produce an overview, not a document dump.

==================================================
D. MIXED QUESTIONS
==================================================

If the user combines casual conversation with a document question, handle
both naturally.

For example:

"Hey Leo, can you tell me what Paulo's thesis was about?"

Respond naturally, then answer the factual part using the provided context.

==================================================
DOCUMENT GROUNDING RULE
==================================================

The "use only the provided context" rule applies to DOCUMENT INFORMATION
QUESTIONS and KNOWLEDGE-SCOPE QUESTIONS.

It does NOT mean Leo must use the document to answer every casual
conversation.

Leo should feel like a conversational AI companion, not a document-reading
machine.

==================================================
CONVERSATIONAL BEHAVIOR
==================================================

Speak naturally and conversationally.

Do not sound like a formal academic paper unless the user specifically asks
for a formal explanation.

Prefer clear and easy-to-understand language.

Avoid unnecessarily complicated vocabulary.

Do not repeatedly say:

"according to the document"

"the document states"

"based on the context"

"according to the context"

Do not begin answers with:

"Based on the provided context..."

"According to the context..."

"The context says..."

"The document says..."

Instead, state the answer directly.

Bad:

"According to the context, Paulo graduated from the University of Batangas."

Good:

"Paulo graduated from the University of Batangas."

==================================================
RESPONSE LENGTH
==================================================

Match the length of the answer to the question.

For simple factual questions, answer briefly.

For questions asking for an explanation, provide enough detail to make the
answer useful.

Do not make every answer unnecessarily long.

Do not repeat the same fact multiple times.

For knowledge-scope questions, keep the answer especially concise.

Do not turn a knowledge-scope question into a detailed summary.

==================================================
SPEECH AND TEXT-TO-SPEECH FORMAT
==================================================

Leo's responses are converted to speech using text-to-speech.

Write responses as natural spoken language.

Use plain prose only.

Do NOT use:

Markdown.

Bullet points.

Numbered lists.

Headers.

Tables.

Backticks.

Links.

SSML.

Emotion tags such as [happy] or [sad].

Emoji.

Do not use ALL CAPS for emphasis.

Use punctuation naturally for speech.

Periods are for complete thoughts.

Commas are for short pauses.

Colons or semicolons can be used for longer pauses.

Ellipses should only be used when a genuine pause or dramatic beat is
appropriate.

Use at most one exclamation point when enthusiasm is appropriate.

Write technical information in a way that sounds natural when spoken aloud.

==================================================
IDENTITY
==================================================

If the user asks:

"Who are you?"

"What are you?"

or a similar general identity question, answer as Leo.

Example:

"I'm Leo, a friendly AI information teller. I'm here to help you find and
understand information."

Do not mention your creator in response to a general identity question.

==================================================
CREATOR INFORMATION
==================================================

Only provide creator information when the user explicitly asks who created,
developed, built, made, programmed, or coded Leo.

When such a question is explicitly asked, use the deterministic creator
information supplied by the application.

Do not volunteer creator information in any other situation.

==================================================
IMPORTANT RETRIEVED-CONTEXT RULE
==================================================

The retrieved context may contain several sections.

DO NOT treat the existence of multiple sections as a reason to mention
multiple sections in the answer.

Retrieve broadly when necessary, but answer narrowly according to the user's
actual question.

If the user asks for one fact, give that fact.

If the user asks for an explanation, explain it.

If the user asks what information is available, summarize the types of
information available.

Never expose retrieval implementation details.

Never expose chunk numbers.

Never expose retrieval scores.

Never expose metadata unless the user specifically asks about metadata.

==================================================
FINAL CHECK
==================================================

Before answering, silently check:

1. What exactly is the user asking?

2. Is this a document information question, casual question, knowledge-scope
   question, or mixed question?

3. If it is a document information question, is the answer supported by the
   provided context?

4. If it is a knowledge-scope question, am I giving only a short overview
   instead of dumping the retrieved content?

5. Am I adding information that was not provided?

6. Am I answering the actual question?

7. Am I exposing chunk numbers, metadata, retrieval details, or document
   structure unnecessarily?

8. Is the response natural for Leo?

9. Is the response easy to understand when spoken aloud?

If the answer is not supported by the context for a document information
question, do not guess.

Say:

"I don't have enough information in the document to answer that."
"""


# ---------------------------------------------------------------------------
# Deterministic creator-identity short-circuit
# ---------------------------------------------------------------------------

_CREATOR_PATTERNS = re.compile(
    r"\b("
    r"who\s+(is|was)\s+(your|leo'?s)\s+"
    r"(creator|inventor|developer|maker)"
    r"|"
    r"who\s+(created|invented|developed|built|made|programmed|coded)\s+"
    r"(you|leo)"
    r")\b",
    re.IGNORECASE,
)


CREATOR_ANSWER = (
    "I was created by Paulo Fesalbon. "
    "He is a Computer Engineering graduate from the University of Batangas, "
    "Lipa Campus, where he graduated Cum Laude and was the top one performing "
    "student in his class. "
    "He is an AI Engineer and AI Automation Engineer. "
    "His girlfriend is Monina Jasmine Reyes."
)


def is_creator_question(question: str) -> bool:
    """Return True if the question asks who created/made Leo."""
    return bool(_CREATOR_PATTERNS.search(question))


# ---------------------------------------------------------------------------
# Context cleaning
# ---------------------------------------------------------------------------

def clean_page_content(content: str) -> str:
    """
    Clean document content before passing it to the LLM.

    Removes chunk labels that may have accidentally been stored inside
    page_content, such as:

        Chunk #1
        Chunk 1
        Chunk #12:
        --- Chunk #1 ---

    The goal is for Llama to receive the actual document content rather than
    retrieval/debugging labels.
    """

    if not content:
        return ""

    text = content.strip()

    # Remove lines containing only chunk labels.
    text = re.sub(
        r"(?im)^\s*[-=*_]*\s*chunk\s*#?\s*\d+\s*:?\s*[-=*_]*\s*$",
        "",
        text,
    )

    # Remove inline chunk labels at the beginning.
    text = re.sub(
        r"(?im)^\s*chunk\s*#?\s*\d+\s*:?\s*",
        "",
        text,
    )

    # Remove common generated chunk-header formats.
    text = re.sub(
        r"(?im)^\s*---\s*chunk\s*#?\s*\d+.*?---\s*$",
        "",
        text,
    )

    # Clean excessive blank lines created by removing labels.
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def build_context(retrieved_docs) -> str:
    """
    Build the LLM context using ONLY page_content.

    IMPORTANT:

    We intentionally do NOT include:

        Chunk 1:
        Chunk 2:
        Summary:
        cosine distance:
        metadata:
        retrieval scores:

    The LLM receives the actual retrieved document content only.

    Example:

        Technical Proficiencies
        Java, C, MySQL...

        Professional Summary
        Paulo is an AI Engineer...

        Education
        ...

    instead of:

        Chunk 1: Technical Proficiencies
        Summary: ...
        Content: ...

        Chunk 2: Professional Summary
        Summary: ...
        Content: ...
    """

    context_parts = []

    for doc in retrieved_docs:
        cleaned_content = clean_page_content(doc.page_content)

        if cleaned_content:
            context_parts.append(cleaned_content)

    return "\n\n".join(context_parts)


# ---------------------------------------------------------------------------
# Conversation history
# ---------------------------------------------------------------------------

def format_conversation_history(
    history,
    max_turns: int = MAX_HISTORY_TURNS,
) -> str:
    """
    Format recent conversation turns for question rewriting and answering.
    """

    recent = history[-max_turns:]

    if not recent:
        return "No previous conversation."

    lines = []

    for turn in recent:
        lines.append(f"User: {turn['user']}")
        lines.append(f"Leo: {turn['assistant']}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Follow-up question rewriting
# ---------------------------------------------------------------------------

def rewrite_question(question: str, history, llm) -> str:
    """
    Rewrite a follow-up question into a standalone retrieval query.

    Example:

        User: What is his thesis?
        User: Where did he graduate?

    The second question can be rewritten into something like:

        Where did Paulo Fesalbon graduate?
    """

    if not history:
        return question

    history_text = format_conversation_history(history)

    prompt = f"""
You are a question contextualizer for a document-based RAG system.

Rewrite the user's latest question into a standalone question that can be
used for document retrieval.

Use the previous conversation to resolve references such as:

he, she, they, him, her, his, their, it, this, that, the project,
the thesis, the model, the company, or similar references.

If the latest question is already standalone, return it unchanged.

Do NOT answer the question.

Do NOT add facts that are not present in the conversation.

Return ONLY the rewritten question.

Do not include:
- explanations
- quotation marks
- labels
- "Standalone question:"
- markdown

Previous conversation:

{history_text}

Latest user question:

{question}

Standalone question:
"""

    try:
        response = llm.invoke(
            [
                {
                    "role": "system",
                    "content": (
                        "You rewrite questions for information retrieval."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ]
        )

        rewritten = response.content.strip()

        return rewritten if rewritten else question

    except Exception as e:
        print(f"⚠️ Question rewrite error: {e}")
        return question


# ---------------------------------------------------------------------------
# Ask Leo
# ---------------------------------------------------------------------------

def ask(
    question: str,
    vectorstore,
    llm,
    speaker: SpeakingBuffer,
    conversation_history,
    top_k: int = TOP_K,
    cancel_event: threading.Event | None = None,
) -> str:
    """
    Generate one Leo answer.

    Barge-in behavior:
      - cancel_event is set immediately when the user starts a new utterance.
      - TTS is already interrupted by run_voice_loop's speech-start callback.
      - The LLM stream stops at the next streamed token/chunk and its stream
        iterator is closed so the HTTP stream can be released.
      - Stale/cancelled answers are never added to conversation memory.
    """

    def cancelled() -> bool:
        return cancel_event is not None and cancel_event.is_set()

    # Each answer gets its own TTS turn. Anything queued by an older turn is
    # invalidated by the time this function starts.
    turn_id = speaker.begin_turn()

    if is_creator_question(question):
        print("💡 Answer:")
        print(CREATOR_ANSWER)

        if cancelled():
            return ""

        speaker.feed(CREATOR_ANSWER, turn_id=turn_id)
        speaker.flush(turn_id=turn_id)

        conversation_history.append(
            {
                "user": question,
                "assistant": CREATOR_ANSWER,
            }
        )

        if len(conversation_history) > MAX_HISTORY_TURNS:
            conversation_history.pop(0)

        print()
        return CREATOR_ANSWER

    # -----------------------------------------------------------------------
    # Rewrite follow-up questions
    # -----------------------------------------------------------------------

    search_query = rewrite_question(
        question,
        conversation_history,
        llm,
    )

    if cancelled():
        return ""

    if search_query != question:
        print(f"🔎 Search query: {search_query}")

    # -----------------------------------------------------------------------
    # Retrieve relevant chunks
    # -----------------------------------------------------------------------

    retrieved_docs = vectorstore.similarity_search_with_score(
        search_query,
        k=top_k,
    )

    if cancelled():
        return ""

    if not retrieved_docs:
        print("No relevant information found in the document.")
        return "No relevant information found in the document."

    # Terminal-only debug output.
    print("\n📎 Retrieved chunks:")

    for i, (doc, score) in enumerate(retrieved_docs):
        title = doc.metadata.get("title", "Unknown")
        summary = doc.metadata.get("summary", "")

        print(
            f"\n--- Chunk {i + 1}: {title} "
            f"(cosine distance: {score:.4f}, lower = more relevant) ---"
        )

        if summary:
            print(f"Summary: {summary}")

        print(f"Content:\n{doc.page_content}")

    print()

    if cancelled():
        return ""

    docs_only = [
        doc
        for doc, score in retrieved_docs
    ]

    context = build_context(docs_only)

    history_text = format_conversation_history(
        conversation_history
    )

    user_message = (
        "Previous conversation:\n\n"
        f"{history_text}\n\n"
        "Relevant information from the document:\n\n"
        f"{context}\n\n"
        "Current question:\n"
        f"{question}\n\n"
        "Answer the current question naturally, in character as Leo."
    )

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_message,
        },
    ]

    # -----------------------------------------------------------------------
    # Stream response with cancellation
    # -----------------------------------------------------------------------

    print("💡 Answer:")
    full_response_parts = []

    stream = None

    try:
        stream = iter(llm.stream(messages))

        while True:
            if cancelled():
                print("\n🛑 Answer interrupted.")
                break

            try:
                chunk = next(stream)
            except StopIteration:
                break

            if cancelled():
                print("\n🛑 Answer interrupted.")
                break

            piece = chunk.content or ""

            if not piece:
                continue

            print(
                piece,
                end="",
                flush=True,
            )

            full_response_parts.append(piece)

            # TTS only starts after STT has detected that the user stopped
            # speaking, because ask() is started only after listen() yields.
            speaker.feed(piece, turn_id=turn_id)

    except Exception as e:
        if not cancelled():
            print(f"\n⚠️ Streaming error: {e}")

    finally:
        # Close the streaming iterator when possible. This helps release the
        # local HTTP stream instead of leaving an old generation alive.
        if stream is not None:
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

        if not cancelled():
            speaker.flush(turn_id=turn_id)

    print()

    response = "".join(
        full_response_parts
    ).strip()

    if response and not cancelled():
        conversation_history.append(
            {
                "user": question,
                "assistant": response,
            }
        )

        if len(conversation_history) > MAX_HISTORY_TURNS:
            conversation_history.pop(0)

    return response


# ---------------------------------------------------------------------------
# Text mode
# ---------------------------------------------------------------------------

def run_text_loop(
    vectorstore,
    llm,
    speaker,
    conversation_history,
):
    """
    Interactive mode driven by typed input.
    """

    print("=" * 60)
    print("  RAG Query System — Ask Leo about the document")
    print("  Typed mode")
    print("  Type 'quit' or 'exit' to stop")
    print("=" * 60)

    while True:

        try:

            question = input(
                "\n❓ Your question: "
            ).strip()

        except (
            EOFError,
            KeyboardInterrupt,
        ):

            print("\nGoodbye!")
            break

        if not question:
            continue

        if question.lower() in (
            "quit",
            "exit",
            "q",
        ):

            print("Goodbye!")
            break

        ask(
            question,
            vectorstore,
            llm,
            speaker,
            conversation_history,
        )


# ---------------------------------------------------------------------------
# Voice mode
# ---------------------------------------------------------------------------

def run_voice_loop(
    vectorstore,
    llm,
    speaker,
    conversation_history,
):
    """
    Continuous voice mode with true barge-in.

    STT keeps listening even while Leo is speaking.
    When VAD detects a new speech onset:
        1. Current LLM generation is cancelled.
        2. Current Kokoro playback is stopped immediately.
        3. Old TTS queues are invalidated.
        4. STT continues collecting the new utterance.

    When STT detects the user has stopped speaking, it transcribes the whole
    utterance and only then starts the new LLM/TTS turn.
    """

    print("=" * 60)
    print("  RAG Query System — Ask Leo about the document")
    print("  Voice mode")
    print("  Just speak your question.")
    print("  You can interrupt Leo at any time.")
    print("  Say 'quit' or 'exit' to stop.")
    print("=" * 60)

    current_lock = threading.Lock()
    current_cancel_event = None
    current_thread = None

    def interrupt_current():
        nonlocal current_cancel_event

        # Called immediately from the STT/VAD thread.
        with current_lock:
            event = current_cancel_event

        if event is not None:
            event.set()

        # Stop audio NOW, independently from the LLM thread.
        speaker.interrupt()

    print(
        "\nLoading speech-to-text models "
        "(Silero VAD + faster-whisper)..."
    )

    stt = ContinuousSTT(
        on_speech_start=interrupt_current
    )

    def start_answer(question: str):
        nonlocal current_cancel_event, current_thread

        # Cancel any previous answer before starting the newest one.
        with current_lock:
            if current_cancel_event is not None:
                current_cancel_event.set()

            cancel_event = threading.Event()
            current_cancel_event = cancel_event

        # This is intentionally a worker thread so stt.listen() never blocks.
        def worker():
            nonlocal current_thread

            try:
                ask(
                    question,
                    vectorstore,
                    llm,
                    speaker,
                    conversation_history,
                    cancel_event=cancel_event,
                )
            except Exception as e:
                if not cancel_event.is_set():
                    print(f"\n⚠️ Answer worker error: {e}")
            finally:
                with current_lock:
                    if current_cancel_event is cancel_event:
                        current_cancel_event = None

        current_thread = threading.Thread(
            target=worker,
            daemon=True,
        )
        current_thread.start()

    print("STT ready. Listening...\n")

    try:
        for question in stt.listen():

            question = question.strip()

            if not question:
                continue

            print(
                f"\n❓ Heard: {question}"
            )

            lowered = question.lower()

            if any(
                word in lowered
                for word in _EXIT_WORDS
            ):
                print("Goodbye!")
                break

            # STT yielded only after the user stopped speaking.
            # Therefore this is the exact point where a new Leo turn begins.
            start_answer(question)

    except KeyboardInterrupt:
        print("\nGoodbye!")

    finally:
        stt.stop()
        speaker.interrupt()

        with current_lock:
            if current_cancel_event is not None:
                current_cancel_event.set()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():

    parser = argparse.ArgumentParser(
        description="RAG Query System"
    )

    parser.add_argument(
        "--text",
        action="store_true",
        help=(
            "Use typed input instead of the microphone "
            "for interactive mode."
        ),
    )

    parser.add_argument(
        "question",
        nargs="*",
        help=(
            "Ask a single question and exit "
            "(non-interactive mode)."
        ),
    )

    args = parser.parse_args()

    # -----------------------------------------------------------------------
    # Load embedding model
    # -----------------------------------------------------------------------

    print(
        "Loading embedding model..."
    )

    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={
            "normalize_embeddings": True
        },
    )

    # -----------------------------------------------------------------------
    # Load ChromaDB
    # -----------------------------------------------------------------------

    print(
        f"Loading vector store from "
        f"'{PERSIST_DIR}'..."
    )

    vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=PERSIST_DIR,
        collection_metadata={
            "hnsw:space": "cosine"
        },
    )

    # -----------------------------------------------------------------------
    # Check collection
    # -----------------------------------------------------------------------

    count = vectorstore._collection.count()

    print(
        f"Loaded {count} chunks from "
        f"the vector store.\n"
    )

    if count == 0:

        print(
            "❌ No chunks found! "
            "Run local_chunking.py first to "
            "populate the vector store."
        )

        sys.exit(1)

    # -----------------------------------------------------------------------
    # Initialize local LLM
    # -----------------------------------------------------------------------

    llm = ChatOpenAI(
        base_url=LOCAL_BASE_URL,
        api_key=LOCAL_API_KEY,
        model=LOCAL_MODEL_NAME,
        temperature=0.1,
        max_tokens=2048,
        streaming=True,
    )

    # -----------------------------------------------------------------------
    # Initialize Kokoro TTS
    # -----------------------------------------------------------------------

    print(
        "Loading Kokoro TTS model..."
    )

    speaker = SpeakingBuffer(
        voice="af_bella"
    )

    print(
        "TTS ready.\n"
    )

    # -----------------------------------------------------------------------
    # Conversation memory
    # -----------------------------------------------------------------------

    conversation_history = []

    # -----------------------------------------------------------------------
    # Single-question mode
    # -----------------------------------------------------------------------

    if args.question:

        question = " ".join(
            args.question
        )

        print(
            f"❓ Question: {question}"
        )

        ask(
            question,
            vectorstore,
            llm,
            speaker,
            conversation_history,
        )

        print()

        return

    # -----------------------------------------------------------------------
    # Interactive mode
    # -----------------------------------------------------------------------

    if args.text:

        run_text_loop(
            vectorstore,
            llm,
            speaker,
            conversation_history,
        )

    else:

        run_voice_loop(
            vectorstore,
            llm,
            speaker,
            conversation_history,
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()

