#!/usr/bin/env python3
"""
Export Lesson 2 review questions to formats useful for Slido manual entry.

Slido does NOT support bulk import. This script outputs:
1. CSV — open in Google Sheets as a reference while creating polls in Slido
2. Copy-paste blocks — one question per block for quick manual entry

Usage:
  .venv/bin/python3 tools/questions_to_slido.py Stage/Lesson_2_Review_Questions.md
  .venv/bin/python3 tools/questions_to_slido.py Stage/Lesson_2_Review_Questions.md --csv Stage/slido_questions.csv
  .venv/bin/python3 tools/questions_to_slido.py Stage/Lesson_2_Review_Questions.md --blocks Stage/slido_blocks.txt
"""
import argparse
import re
import sys
from pathlib import Path


def parse_questions(md_path: str) -> list[dict]:
    """Parse markdown and extract questions with options and answers."""
    text = Path(md_path).read_text(encoding="utf-8")
    questions = []
    current = None

    for line in text.splitlines():
        # Question header: ## Q1. ... or ### I1-B. ... or ### I1-C. [T/F] ...
        if re.match(r"^#{2,3}\s+", line):
            if current and current.get("question"):
                questions.append(current)
            title = re.sub(r"^#{2,3}\s+", "", line).strip()
            is_tf = "[T/F]" in title
            q_text = re.sub(r"^[^.]+\.\s*", "", title).strip()  # Remove "Q1." etc.
            q_text = re.sub(r"\[T/F\]\s*", "", q_text).strip()  # Remove [T/F]
            current = {
                "id": title.split(".")[0].strip() if "." in title else "",
                "question": q_text or title,
                "options": [{"key": "T", "text": "True"}, {"key": "F", "text": "False"}] if is_tf else [],
                "answer": "",
                "multi": False,
            }

        # Option: - A) ... (skip if T/F already has True/False)
        elif current and (m := re.match(r"^-\s*([A-E])\)\s*(.+)$", line)):
            if not (current["options"] and current["options"][0]["key"] == "T"):
                current["options"].append({"key": m.group(1), "text": m.group(2).strip()})

        # Answer: **Answer: C** or **Answer: A, B, D** or **Answer: TRUE**
        elif current and (m := re.match(r"^\*\*Answer:\s*(.+?)\*\*", line)):
            ans = m.group(1).strip().upper()
            current["answer"] = ans
            current["multi"] = "," in ans

    if current and current.get("question"):
        questions.append(current)

    # Filter out section headers (no options, no answer)
    return [q for q in questions if q["options"] or q["answer"]]


def to_csv(questions: list[dict]) -> str:
    """Output CSV for Google Sheets."""
    rows = [["#", "Question", "Option A", "Option B", "Option C", "Option D", "Option E", "Correct", "Multi?"]]
    for i, q in enumerate(questions, 1):
        opts = {o["key"]: o["text"] for o in q["options"]}
        row = [
            str(i),
            q["question"],
            opts.get("A", ""),
            opts.get("B", ""),
            opts.get("C", ""),
            opts.get("D", ""),
            opts.get("E", ""),
            q["answer"],
            "Yes" if q["multi"] else "",
        ]
        rows.append(row)
    return "\n".join(",".join(f'"{c.replace(chr(34), chr(34)+chr(34))}"' for c in row) for row in rows)


def to_blocks(questions: list[dict]) -> str:
    """Output copy-paste blocks for Slido manual entry."""
    blocks = []
    for i, q in enumerate(questions, 1):
        block = [f"--- Question {i} ---", q["question"], ""]
        for o in q["options"]:
            block.append(f"  {o['key']}) {o['text']}")
        block.append(f"  → Answer: {q['answer']}" + (" (Select ALL)" if q["multi"] else ""))
        block.append("")
        blocks.append("\n".join(block))
    return "\n".join(blocks)


def main():
    p = argparse.ArgumentParser(description="Export questions for Slido manual entry")
    p.add_argument("md_file", help="Path to Lesson_2_Review_Questions.md")
    p.add_argument("--csv", metavar="FILE", help="Write CSV to file")
    p.add_argument("--blocks", metavar="FILE", help="Write copy-paste blocks to file")
    args = p.parse_args()

    if not Path(args.md_file).exists():
        print(f"Error: {args.md_file} not found", file=sys.stderr)
        sys.exit(1)

    questions = parse_questions(args.md_file)
    print(f"Parsed {len(questions)} questions", file=sys.stderr)

    if args.csv:
        Path(args.csv).write_text(to_csv(questions), encoding="utf-8")
        print(f"CSV written to {args.csv}", file=sys.stderr)
        print(f"  → Open in Google Sheets: https://sheets.google.com → File → Import → Upload {args.csv}", file=sys.stderr)

    if args.blocks:
        Path(args.blocks).write_text(to_blocks(questions), encoding="utf-8")
        print(f"Blocks written to {args.blocks}", file=sys.stderr)
        print(f"  → Use as reference while creating polls in Slido", file=sys.stderr)

    if not args.csv and not args.blocks:
        print(to_csv(questions))


if __name__ == "__main__":
    main()
