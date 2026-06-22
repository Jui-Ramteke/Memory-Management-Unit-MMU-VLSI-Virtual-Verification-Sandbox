// =========================================================================
// Title: TLB Visual Grid Monitor Component
// Description: Renders the active layout of a 2-way set-associative cache,
//              visually indicating tag comparisons, ways, and pseudo-LRU.
// =========================================================================

import React from "react";
import { TlbEntry } from "../types";
import { ChevronRight, Cpu, Eye, Info } from "lucide-react";

interface TlbMonitorProps {
  tlbData: TlbEntry[][];
  lruBits: number[]; // size 4
  activeSet: number | null;
  activeWay: number | null;
  currentAsid: number;
}

export default function TlbMonitor({
  tlbData,
  lruBits,
  activeSet,
  activeWay,
  currentAsid,
}: TlbMonitorProps) {
  return (
    <div className="bg-[#0a0f1d] border border-[#00f2ff33] rounded-lg p-5 shadow-[0_0_15px_rgba(0,242,255,0.05)] relative overflow-hidden">
      <div className="flex items-center justify-between mb-4 border-b border-[#ffffff11] pb-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-[#00f2ff] animate-pulse" />
          <h3 className="font-mono text-sm font-black text-white uppercase tracking-wider">
            Translation Lookaside Buffer (TLB) Cache
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff00e5] inline-block"></span>
            ASID: <strong className="text-[#ff00e5]">0x{currentAsid.toString(16).toUpperCase()}</strong>
          </span>
          <span className="text-slate-400">
            Format: <span className="text-[#00f2ff] font-bold">2-Way Set-Associative</span>
          </span>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 mb-4 bg-[#050914] p-2.5 rounded border border-[#ffffff11] leading-relaxed font-mono">
        <span className="text-[#00f2ff] font-bold">INFO //</span> Total 8 entries. Each lookup takes the 20-bit VPN. Index = VPN[1:0] (Set 0-3). Tag = VPN[19:2]. Match condition: Valid == 1 AND Tag == VPN_Tag AND ASID == CPU_ASID.
      </div>

      {/* Grid of Sets */}
      <div className="space-y-4">
        {tlbData.map((ways, setIdx) => {
          const isSetProbed = activeSet === setIdx;
          const targetLruWay = lruBits[setIdx]; // 0 or 1

          return (
            <div
              key={setIdx}
              className={`p-3 rounded border transition-all duration-300 ${
                isSetProbed
                  ? "bg-[#050914] border-[#00f2ff] shadow-[0_0_15px_rgba(0,242,255,0.15)] scale-[1.01]"
                  : "bg-[#050914] border-[#ffffff11]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs font-bold text-white flex items-center gap-1">
                  {isSetProbed && <ChevronRight className="w-3.5 h-3.5 text-[#00f2ff] animate-bounce" />}
                  SET #{setIdx}{" "}
                  <span className="text-[10px] text-slate-500 font-normal">
                    (Index match: {setIdx.toString(2).padStart(2, "0")})
                  </span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Pseudo-LRU Least-Used Way:{" "}
                  <strong className="text-[#ff00e5]">Way {targetLruWay}</strong>
                </span>
              </div>

              {/* Both Ways columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ways.map((entry, wayIdx) => {
                  const isWayHit = isSetProbed && activeWay === wayIdx;
                  const isLruTarget = targetLruWay === wayIdx;

                  return (
                    <div
                      key={wayIdx}
                      className={`font-mono text-[11px] p-2.5 rounded border transition-all duration-300 ${
                        isWayHit
                          ? "bg-[#39ff14]/10 border-[#39ff14] shadow-[0_0_10px_rgba(57,255,20,0.1)] ring-1 ring-[#39ff14]/30"
                          : isSetProbed
                          ? "bg-[#020408] border-[#00f2ff33]"
                          : "bg-[#020408] border-[#ffffff11]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-[#ffffff11]">
                        <span
                          className={`font-bold uppercase ${
                            isWayHit ? "text-[#39ff14]" : "text-slate-400"
                          }`}
                        >
                          Way {wayIdx}{" "}
                          {isWayHit && (
                            <span className="ml-1 text-[9px] bg-[#39ff14]/20 text-[#39ff14] px-1.5 py-0.2 rounded font-mono font-black uppercase animate-pulse border border-[#39ff14]/30">
                              HIT MATCH
                            </span>
                          )}
                          {!entry.valid && (
                            <span className="ml-1 text-[9px] bg-[#020408] text-slate-600 px-1 py-0.2 rounded font-normal uppercase border border-[#ffffff11]">
                              EMPTY
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {isLruTarget ? "LRU Target" : "Recent"}
                        </span>
                      </div>

                      {entry.valid ? (
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-350">
                          <div>
                            <span className="text-slate-500">Tag:</span>{" "}
                            <span className="text-[#00f2ff] font-bold">
                              0x{entry.tag.toString(16).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">ASID:</span>{" "}
                            <span className="text-[#ff00e5] font-bold">
                              0x{entry.asid.toString(16).toUpperCase()}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500">PPN (Frame):</span>{" "}
                            <span className="text-white font-extrabold">
                              0x{entry.ppn.toString(16).toUpperCase()}
                            </span>
                          </div>
                          <div className="col-span-2 flex items-center gap-1.5 mt-1 pt-1 border-t border-[#ffffff11] text-[9px]">
                            <span className="text-slate-500">Perm:</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] border ${
                                entry.user ? "bg-[#ff00e5]/10 text-[#ff00e5] border-[#ff00e5]/30" : "bg-[#020408] text-slate-400 border-[#ffffff11]"
                              }`}
                            >
                              {entry.user ? "USER" : "SUPER"}
                            </span>
                            <span className="text-slate-700">|</span>
                            <span className={entry.read ? "text-[#39ff14] font-bold" : "text-slate-600"}>R</span>
                            <span className={entry.write ? "text-[#00f2ff] font-bold" : "text-slate-600"}>W</span>
                            <span className={entry.exec ? "text-[#ff00e5] font-bold" : "text-slate-600"}>X</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-600 text-[10px] italic py-2 text-center">
                          Invalid / Unallocated
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
