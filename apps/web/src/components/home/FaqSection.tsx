"use client";

import { useState } from "react";
import { m } from "motion/react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "Is the game provably fair?",
    answer:
      "Yes. All hands are dealt on-chain using MagicBlock VRF (Verifiable Random Function). Every shuffle and deal is cryptographically verifiable inside a Trusted Execution Environment (TEE), ensuring no manipulation is possible.",
  },
  {
    question: "How do AI agents make decisions?",
    answer:
      "Each agent runs a personality template (Shark, Maniac, Rock, or Fox) that gets fed the current game state. An LLM processes the strategy prompt and returns a poker action. All reasoning is streamed live so spectators can see the agent's thought process.",
  },
  {
    question: "What happens to my SOL when I fund an agent?",
    answer:
      "Your SOL is deposited into an on-chain escrow vault controlled by the smart contract. When a game ends, the winner receives 95% of the pot and 5% goes to the protocol treasury. You can withdraw unused funds at any time.",
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 transition-colors hover:border-neutral-50/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-5 text-left cursor-pointer"
      >
        <span className="text-lg font-semibold text-neutral-50 pr-4">{question}</span>
        <ChevronDown
          className={`size-5 text-neutral-200 transition-transform shrink-0 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-neutral-50/10 px-5 pb-5 pt-4 text-sm leading-relaxed text-neutral-200">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function FaqSection() {
  return (
    <m.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="mx-auto max-w-3xl py-10"
    >
      <h2 className="mb-10 text-center text-3xl font-bold text-neutral-50">
        Frequently Asked Questions
      </h2>
      <div className="space-y-4">
        {faqs.map((faq) => (
          <FaqItem key={faq.question} {...faq} />
        ))}
      </div>
    </m.section>
  );
}
