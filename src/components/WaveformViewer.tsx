// =========================================================================
// Title: Dynamic SVG Logic Waveform Visualizer Component
// Description: Renders digital clock cycles and bus transitions of the MMU
//              modules dynamically to represent logic wave analysis.
// =========================================================================

import React, { useRef, useEffect } from "react";
import { Activity, Download, RefreshCw, Zap } from "lucide-react";

interface SignalData {
  name: string;
  type: "clock" | "binary" | "bus";
  color: string;
  history: (number | string | boolean)[];
}

interface WaveformViewerProps {
  signals: SignalData[];
  currentCycle: number;
  onResetWaveform: () => void;
}

export default function WaveformViewer({
  signals,
  currentCycle,
  onResetWaveform,
}: WaveformViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Settings for drawing
  const cycleWidth = 60;   // Pixels per half clock cycle
  const rowHeight = 45;    // Pixels per signal row
  const rowPadding = 10;
  const labelWidth = 110;  // Pixels reserved for signal names on the left
  const paddingRight = 40;

  // Let's calculate total columns based on maximum history or at least 12 cycles
  const totalCycles = Math.max(12, ...signals.map((s) => s.history.length));
  const svgWidth = labelWidth + totalCycles * cycleWidth + paddingRight;
  const svgHeight = rowHeight * signals.length + 50;

  // Render a standard VCD file from wave history
  const handleExportVCD = () => {
    let vcdText = `$date\n   ${new Date().toISOString()}\n$end\n`;
    vcdText += `$version\n   Google AI Studio MMU Virtual VCD Generator\n$end\n`;
    vcdText += `$timescale 1ns $end\n`;
    vcdText += `$scope module mmu_tb $end\n`;
    
    // Define signal symbols
    const symbols = ["clk", "req_v", "req_a", "busy", "mem_req", "mem_a", "mem_r", "hit", "refill", "resp_v", "resp_a", "pf", "pr"];
    signals.forEach((sig, index) => {
      const sym = symbols[index] || `s${index}`;
      vcdText += `$var reg ${sig.type === "bus" ? "32" : "1"} ${sym} ${sig.name} $end\n`;
    });
    vcdText += `$upscope $end\n$enddefinitions $end\n#0\n$dumpvars\n`;

    // Initial dump values
    signals.forEach((sig, index) => {
      const sym = symbols[index] || `s${index}`;
      const firstVal = sig.history[0];
      if (sig.type === "bus") {
        const hexVal = String(firstVal).replace("0x", "");
        vcdText += `b${hexVal} ${sym}\n`;
      } else {
        vcdText += `${firstVal ? "1" : "0"}${sym}\n`;
      }
    });

    // Cycle by cycle transitions
    for (let c = 1; c < totalCycles; c++) {
      vcdText += `#${c * 20}\n`; // 20ns clock cycle spacing
      signals.forEach((sig, index) => {
        const sym = symbols[index] || `s${index}`;
        const prev = sig.history[c - 1];
        const val = sig.history[c];
        if (val !== prev && val !== undefined) {
          if (sig.type === "bus") {
            const hexVal = String(val).replace("0x", "");
            vcdText += `b${hexVal} ${sym}\n`;
          } else {
            vcdText += `${val ? "1" : "0"}${sym}\n`;
          }
        }
      });
    }

    const blob = new Blob([vcdText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mmu_simulation_waves.vcd";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-[#0a0f1d] border border-[#ff00e533] rounded-lg p-5 shadow-[0_0_15px_rgba(255,0,229,0.05)] relative overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 border-b border-[#ffffff11] pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#ff00e5]" />
          <h3 className="font-mono text-sm font-black text-white uppercase tracking-wider">
            Verilog Digital Waveform Analyzer (VCD Trace)
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={onResetWaveform}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white border border-[#ffffff11] bg-[#020408] px-3 py-1.5 rounded text-xs transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            FLUSH TRACE
          </button>
          <button
            onClick={handleExportVCD}
            className="flex items-center gap-1.5 text-[#ff00e5] font-bold hover:text-white border border-[#ff00e555] bg-[#ff00e5]/10 px-3 py-1.5 rounded text-xs transition shadow-sm h-8 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#ff00e5]" />
            EXPORT .VCD
          </button>
        </div>
      </div>

      {/* SVG Container wrapping scrolled area */}
      <div 
        ref={containerRef}
        className="overflow-x-auto border border-[#ffffff11] bg-[#050914] p-3 rounded style-scrollbar"
      >
        <div style={{ minWidth: `${svgWidth}px` }} className="relative select-none">
          <svg
            width={svgWidth}
            height={svgHeight}
            className="font-mono text-[10px]"
          >
            {/* SVG Filter for Glowing Neon Neon */}
            <defs>
              <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-pink" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Draw grid cycle boundaries */}
            {Array.from({ length: totalCycles }).map((_, cIdx) => {
              const xCoord = labelWidth + cIdx * cycleWidth;
              return (
                <g key={cIdx}>
                  {/* Grid vertical line */}
                  <line
                    x1={xCoord}
                    y1={10}
                    x2={xCoord}
                    y2={svgHeight - 35}
                    stroke="#1e293b"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  {/* X-axis clock period label */}
                  <text
                    x={xCoord + 4}
                    y={svgHeight - 15}
                    fill="#475569"
                    className="text-[9px] font-bold"
                  >
                    T{cIdx}
                  </text>
                </g>
              );
            })}

            {/* Vertical Boundary dividing labels & waves */}
            <line
              x1={labelWidth}
              y1={5}
              x2={labelWidth}
              y2={svgHeight - 35}
              stroke="#334155"
              strokeWidth="2"
            />

            {/* Draw each signal row */}
            {signals.map((sig, rIdx) => {
              const yBase = rIdx * rowHeight + 30; // base floor
              const yHigh = yBase - 18;           // logic 1 line
              const yLow = yBase;                // logic 0 line

              return (
                <g key={sig.name}>
                  {/* Signal text label on left side */}
                  <text
                    x="10"
                    y={yBase - 6}
                    fill="#cbd5e1"
                    className="font-bold text-xs"
                  >
                    {sig.name}
                  </text>

                  {/* Signal Type background tag */}
                  <rect
                    x="85"
                    y={yBase - 15}
                    width="20"
                    height="12"
                    rx="2"
                    fill={sig.type === "bus" ? "#312e81" : sig.type === "clock" ? "#064e3b" : "#451a03"}
                    className="opacity-70"
                  />
                  <text
                    x="88"
                    y={yBase - 6}
                    fill={sig.type === "bus" ? "#818cf8" : sig.type === "clock" ? "#34d399" : "#fb923c"}
                    className="text-[8px] font-bold uppercase"
                  >
                    {sig.type === "bus" ? "bus" : sig.type === "clock" ? "clk" : "bin"}
                  </text>

                  {/* Trace the wave line across cycles */}
                  {Array.from({ length: totalCycles }).map((_, cIdx) => {
                    const xStart = labelWidth + cIdx * cycleWidth;
                    const xEnd = xStart + cycleWidth;

                    const curVal = sig.history[cIdx];
                    const nextVal = sig.history[cIdx + 1];

                    if (sig.type === "clock") {
                      // Clocks just toggle perfectly inside the cycle width
                      const xHalf = xStart + cycleWidth / 2;
                      return (
                        <path
                          key={cIdx}
                          d={`M ${xStart} ${yLow} L ${xStart} ${yHigh} L ${xHalf} ${yHigh} L ${xHalf} ${yLow} L ${xEnd} ${yLow}`}
                          fill="none"
                          stroke={sig.color}
                          strokeWidth="2"
                        />
                      );
                    }

                    if (sig.type === "binary") {
                      // Draw binary logic representation. Let's cast curVal to boolean
                      const bitHigh = curVal === true || curVal === 1 || String(curVal).toLowerCase() === "true" || String(curVal) === "1";
                      const yTarget = bitHigh ? yHigh : yLow;
                      const hasTransition = nextVal !== undefined && (bitHigh !== (nextVal === true || nextVal === 1 || String(nextVal).toLowerCase() === "true" || String(nextVal) === "1"));

                      return (
                        <path
                          key={cIdx}
                          d={`M ${xStart} ${yTarget} L ${xEnd} ${yTarget} ${hasTransition ? `L ${xEnd} ${bitHigh ? yLow : yHigh}` : ""}`}
                          fill="none"
                          stroke={sig.color}
                          strokeWidth="2.5"
                          filter={bitHigh && (sig.color === "#06b6d4" || sig.color === "#f43f5e") ? (sig.color === "#06b6d4" ? "url(#glow-cyan)" : "url(#glow-pink)") : ""}
                        />
                      );
                    }

                    if (sig.type === "bus") {
                      // Draw hex-bus diagram
                      const isUnasserted = curVal === undefined || curVal === null || curVal === "Z" || curVal === 0 || curVal === "32'b0" || curVal === "0x0" || curVal === "0x00000000";
                      
                      if (isUnasserted) {
                        return (
                          <g key={cIdx}>
                            {/* Center flat line representing unasserted bus */}
                            <line
                              x1={xStart}
                              y1={yBase - 9}
                              x2={xEnd}
                              y2={yBase - 9}
                              stroke="#475569"
                              strokeWidth="1.5"
                            />
                            {/* If transitioning to a valid value next cycle */}
                            {nextVal !== undefined && nextVal !== null && nextVal !== "Z" && nextVal !== 0 && nextVal !== "32'b0" && nextVal !== "0x0" && (
                              <path
                                d={`M ${xEnd - 5} ${yBase - 9} L ${xEnd} ${yHigh} M ${xEnd - 5} ${yBase - 9} L ${xEnd} ${yLow}`}
                                stroke="#475569"
                                strokeWidth="1.5"
                              />
                            )}
                          </g>
                        );
                      } else {
                        // Styled hexagon container
                        const pathD = `M ${xStart} ${yBase - 9} L ${xStart + 6} ${yHigh} L ${xEnd - 6} ${yHigh} L ${xEnd} ${yBase - 9} L ${xEnd - 6} ${yLow} L ${xStart + 6} ${yLow} Z`;
                        const shortStr = String(curVal).length > 8 ? String(curVal).substring(0, 8) + ".." : String(curVal);
                        
                        return (
                          <g key={cIdx}>
                            <path
                              d={pathD}
                              fill="#0f172a"
                              stroke={sig.color}
                              strokeWidth="1.5"
                            />
                            <text
                              x={xStart + (cycleWidth / 2)}
                              y={yBase - 6}
                              fill="#e2e8f0"
                              textAnchor="middle"
                              className="text-[8px] font-bold font-mono fill-slate-300"
                            >
                              {shortStr}
                            </text>
                          </g>
                        );
                      }
                    }

                    return null;
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      
      <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500 font-mono">
        <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
        <span>Live synchronous trace logs updated at posedge clk transitions. Max frequency scale simulated at 50 MHz.</span>
      </div>
    </div>
  );
}
