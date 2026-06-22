// =========================================================================
// Title: AI Academic VLSI Tutor Component
// Description: Provides a direct chat portal to our server-side Gemini route.
//              Leverages prebuilt suggested prompts for MMU questions.
// =========================================================================

import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Sparkles, MessageSquare, Loader2, ArrowRight } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Explain how the Pseudo-LRU replacement algorithm works in this Verilog TLB.",
  "Under what circumstances does a Protection Fault rise instead of a Page Fault?",
  "Explain the difference between a 2-level and a 3-level page walk in hardware.",
  "How do hardware designers use Yosys to synthesize this MMU design?",
];

export default function AiTutor() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Welcome to the MMU hardware lab! I am your AI Hardware Architect Mentor, powered by Gemini 3.5 Flash. I am fully integrated into this Verilog sandbox to explain address translations, TLB lookups, page-table walker circuits, and Yosys synthesis. Ask me anything, or choose a prompt below!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const rawPrompt = textToSend || input;
    if (!rawPrompt.trim() || loading) return;

    const userMessage: Message = { role: "user", content: rawPrompt };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await response.json();
      if (response.ok && data.text) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.error || "The AI tutor server returned an empty or invalid response."}`,
          },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to contact the server tutor: ${err.message}. Ensure the dev server is active and the port handles Express.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0a0f1d] border border-[#ff00e533] rounded-lg flex flex-col h-[520px] shadow-[0_0_15px_rgba(255,0,229,0.05)] relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#ffffff11] bg-[#050914] rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="p-1 px-1.5 rounded bg-[#ff00e5]/10 text-[#ff00e5] border border-[#ff00e533]">
            <Sparkles className="w-4 h-4 text-[#ff00e5] animate-pulse" />
          </div>
          <div>
            <h4 className="font-mono text-sm font-black text-white uppercase tracking-wider">
              AI VLSI Hardware Architect Mentor
            </h4>
            <span className="text-[10px] text-slate-500 font-mono">
              Powered by Gemini 3.5 Flash & Active RTL Engine
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#ff00e5] font-mono bg-[#ff00e5]/10 border border-[#ff00e544] px-2.5 py-0.5 rounded animate-pulse">
          <span className="w-1.5 h-1.5 bg-[#ff00e5] rounded-full"></span>
          ONLINE
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 style-scrollbar bg-[#020408]">
        {messages.map((msg, index) => {
          const isAi = msg.role === "assistant";
          return (
            <div
              key={index}
              className={`flex items-start gap-2.5 ${isAi ? "justify-start" : "justify-end"}`}
            >
              {isAi && (
                <div className="w-7 h-7 rounded bg-[#ff00e5]/10 border border-[#ff00e533] flex items-center justify-center shrink-0 text-[#ff00e5] mt-0.5 shadow">
                  <Bot className="w-4 h-4 text-[#ff00e5]" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded p-3 text-xs leading-relaxed font-sans border ${
                  isAi
                    ? "bg-[#0a0f1d] border-[#ffffff11] text-slate-300"
                    : "bg-[#ff00e5]/10 border-[#ff00e544] text-white"
                }`}
              >
                {/* Formatted Text rendering */}
                <div className="prose prose-invert prose-xs whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
              {!isAi && (
                <div className="w-7 h-7 rounded bg-[#00f2ff]/10 border border-[#00f2ff33] flex items-center justify-center shrink-0 text-[#00f2ff] mt-0.5 shadow">
                  <User className="w-4 h-4 text-[#00f2ff]" />
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-start gap-2.5 justify-start">
            <div className="w-7 h-7 rounded bg-[#ff00e5]/10 border border-[#ff00e533] flex items-center justify-center shrink-0 text-[#ff00e5] mt-0.5 shadow">
              <Loader2 className="w-4 h-4 text-[#ff00e5] animate-spin" />
            </div>
            <div className="bg-[#0a0f1d] border border-[#ffffff11] rounded p-3 text-xs text-slate-500 font-mono animate-pulse">
              hardware_mentor compiles explanation...
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Suggestions section */}
      {messages.length === 1 && (
        <div className="px-4 pb-2 bg-[#020408]">
          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 mb-2 uppercase">
            <MessageSquare className="w-3.5 h-3.5 text-slate-600" /> Suggested Lab Questions:
          </span>
          <div className="grid grid-cols-1 gap-1.5 max-h-[120px] overflow-y-auto">
            {SUGGESTIONS.map((str, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(str)}
                className="text-left text-[10px] text-slate-400 hover:text-white bg-[#0a0f1d] hover:bg-[#ff00e5]/5 border border-[#ffffff11] hover:border-[#ff00e555] p-2 rounded transition font-mono flex items-center justify-between gap-2 group cursor-pointer"
              >
                <span className="truncate">{str}</span>
                <ArrowRight className="w-3 h-3 text-[#ff00e5]/40 group-hover:text-[#ff00e5] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat input form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-[#ffffff11] bg-[#050914] rounded-b-lg flex gap-2 items-center"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loading ? "Waiting for response..." : "Ask your Hardware Mentor about caching, walks, or Verilog..."}
          disabled={loading}
          className="flex-1 bg-[#020408] border border-[#ffffff11] disabled:opacity-50 text-slate-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-[#ff00e5]/50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-[#ff00e5] hover:bg-[#ff00e5]/80 disabled:opacity-40 text-black font-bold rounded p-2.5 transition flex items-center justify-center cursor-pointer shadow-[0_0_10px_rgba(255,0,229,0.3)]"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
