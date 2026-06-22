// =========================================================================
// Title: MMU Interactive Virtual Simulation Lab - Main App Entry
// Description: Multi-tab interactive workstation. Replicates synthesizable
//              Verilog clock-edge states, compiles register trackers, and
//              links CAD tools, SVG waveform analysers, and the Gemini AI Mentor.
// =========================================================================

import React, { useState, useEffect } from "react";
import {
  Activity,
  Play,
  RotateCcw,
  SkipForward,
  Cpu,
  BookOpen,
  Compass,
  ArrowRight,
  ShieldAlert,
  FolderLock,
  Info,
  Layers,
  Sparkles,
  Award,
  BookMarked
} from "lucide-react";
import { TlbEntry, PtwState, MmuState, SimulationStepLog, PresetMapping } from "./types";
import TlbMonitor from "./components/TlbMonitor";
import WaveformViewer from "./components/WaveformViewer";
import CodeExplorer from "./components/CodeExplorer";
import AiTutor from "./components/AiTutor";

// Presets (corresponds to verification suite in Verilog testbench)
const PRESETS: PresetMapping[] = [
  {
    name: "User Read Successful (TLB Miss -> walk -> Hit)",
    va: "0x00403120",
    user: true,
    write: false,
    exec: false,
    description: "Standard User program access. Triggers L1/L2 table walking (maps PPN 0x84000), refills cache, and translates. Succeeds instantly on reuse!",
    expectedResult: "Translated Physical: 0x84000120"
  },
  {
    name: "User privilege fault (Accessing supervisor-only page)",
    va: "0x00805555",
    user: true,
    write: false,
    exec: false,
    description: "Mapped as Supervisor only. Walker completes walk, but TLB protection check blocks translation because privilege levels mismatch.",
    expectedResult: "Protection Fault (Privilege violation)"
  },
  {
    name: "Supervisor write fault (ReadOnly violation)",
    va: "0x00805555",
    user: false,
    write: true,
    exec: false,
    description: "Supervisor mode clears privilege checks, but write request is issued on a Read-Only page. Checks trigger protection fault.",
    expectedResult: "Protection Fault (Write RO violation)"
  },
  {
    name: "Page fault (Unmapped page mapping)",
    va: "0x0FC00000",
    user: true,
    write: false,
    exec: false,
    description: "Virtual address outside mapped boundaries. Level 1 walk returns valid bit = 0. Walker terminates with page fault exception.",
    expectedResult: "Page Fault (Invalid translation entry)"
  }
];

// Initial Empty TLB (4 Sets x 2 Ways)
const createEmptyTlb = (): TlbEntry[][] => {
  const tlb: TlbEntry[][] = [];
  for (let s = 0; s < 4; s++) {
    const ways: TlbEntry[] = [];
    for (let w = 0; w < 2; w++) {
      ways.push({
        valid: false,
        user: false,
        read: false,
        write: false,
        exec: false,
        tag: 0,
        asid: 0,
        ppn: 0,
        way: w,
      });
    }
    tlb.push(ways);
  }
  return tlb;
};

// Main App Component
export default function App() {
  const [activeTab, setActiveTab] = useState<"workspace" | "codebase" | "aitutor">("workspace");

  // MMU Config State
  const [mmuEnable, setMmuEnable] = useState<boolean>(true);
  const [asid, setAsid] = useState<number>(0x5F);
  const [satpPpn, setSatpPpn] = useState<number>(0x01000); // 32'h01000000 base

  // CPU translated request states
  const [vaInput, setVaInput] = useState<string>("0x00403120");
  const [reqUser, setReqUser] = useState<boolean>(true);
  const [reqWrite, setReqWrite] = useState<boolean>(false);
  const [reqExec, setReqExec] = useState<boolean>(false);

  // Simulation State Machine Outputs
  const [mmuState, setMmuState] = useState<MmuState>("IDLE");
  const [ptwState, setPtwState] = useState<PtwState>("IDLE");
  const [resolvedPa, setResolvedPa] = useState<string>("--");
  const [respValid, setRespValid] = useState<boolean>(false);
  const [pageFault, setPageFault] = useState<boolean>(false);
  const [protFault, setProtFault] = useState<boolean>(false);
  const [activeSet, setActiveSet] = useState<number | null>(null);
  const [activeWay, setActiveWay] = useState<number | null>(null);

  // Main Memory Page Table Contents (emulated)
  const [memBusReq, setMemBusReq] = useState<boolean>(false);
  const [memBusAddr, setMemBusAddr] = useState<string>("--");
  const [memBusReady, setMemBusReady] = useState<boolean>(false);

  // Discrete arrays
  const [tlb_data, setTlbData] = useState<TlbEntry[][]>(createEmptyTlb());
  const [lru_bits, setLruBits] = useState<number[]>([0, 0, 0, 0]); // 1 bit per set, pointing to LRU way (0 or 1)

  // System parameters
  const [cycle, setCycle] = useState<number>(0);
  const [logs, setLogs] = useState<SimulationStepLog[]>([]);

  // Waveform History Lists
  const [waveClk, setWaveClk] = useState<number[]>([0]);
  const [waveReqV, setWaveReqV] = useState<(boolean | number)[]>([0]);
  const [waveReqA, setWaveReqA] = useState<(string | number)[]>([0]);
  const [waveBusy, setWaveBusy] = useState<(boolean | number)[]>([0]);
  const [waveMemReq, setWaveMemReq] = useState<(boolean | number)[]>([0]);
  const [waveMemAddr, setWaveMemAddr] = useState<(string | number)[]>([0]);
  const [waveMemReady, setWaveMemReady] = useState<(boolean | number)[]>([0]);
  const [waveHit, setWaveHit] = useState<(boolean | number)[]>([0]);
  const [waveRefill, setWaveRefill] = useState<(boolean | number)[]>([0]);
  const [waveRespV, setWaveRespV] = useState<(boolean | number)[]>([0]);
  const [waveRespA, setWaveRespA] = useState<(string | number)[]>([0]);
  const [wavePF, setWavePF] = useState<(boolean | number)[]>([0]);
  const [wavePrF, setWavePrF] = useState<(boolean | number)[]>([0]);

  // Intermediary Latched variables
  const [latchedVa, setLatchedVa] = useState<number>(0);
  const [latchedUser, setLatchedUser] = useState<boolean>(true);
  const [latchedWrite, setLatchedWrite] = useState<boolean>(false);
  const [latchedExec, setLatchedExec] = useState<boolean>(false);
  
  // Walker latched registries
  const [l1Pte, setL1Pte] = useState<number>(0);
  const [l2Pte, setL2Pte] = useState<number>(0);
  const [refillVpn, setRefillVpn] = useState<number>(0);
  const [refillPpn, setRefillPpn] = useState<number>(0);
  const [refillPerms, setRefillPerms] = useState<any>({ user: false, read: false, write: false, exec: false });

  // Add an entry to the visual simulation logs
  const addLog = (message: string, type: "info" | "success" | "warn" | "error" | "bus" = "info") => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [
      ...prev,
      {
        cycle: cycle,
        state: mmuState,
        ptwState: ptwState,
        message: message,
        type: type,
        timestamp: timestamp,
      },
    ]);
  };

  // Synchronize dynamic waveform tracking arrays at every clock edge
  const updateWaveformHistory = (nextClk: number, tempState: MmuState, tempPtw: PtwState, tempRespV: boolean, tempResolvedPa: string, tempPf: boolean, tempPr: boolean) => {
    setWaveClk((prev) => [...prev, nextClk]);
    setWaveReqV((prev) => [...prev, (mmuState === "IDLE" && tempState === "LOOKUP") ? 1 : 0]);
    setWaveReqA((prev) => [...prev, (mmuState === "IDLE" && tempState === "LOOKUP") ? vaInput : "Z"]);
    setWaveBusy((prev) => [...prev, tempState !== "IDLE" ? 1 : 0]);
    
    // Memory
    const isMemReq = (tempPtw === "WAIT_L1" || tempPtw === "WAIT_L2");
    setWaveMemReq((prev) => [...prev, isMemReq ? 1 : 0]);
    setWaveMemReady((prev) => [...prev, isMemReq && memBusReady ? 1 : 0]);
    setWaveMemAddr((prev) => [...prev, isMemReq ? memBusAddr : "Z"]);
    
    // Internal States
    setWaveHit((prev) => [...prev, (mmuState === "LOOKUP" && activeWay !== null) ? 1 : 0]);
    setWaveRefill((prev) => [...prev, tempState === "REFILL" ? 1 : 0]);
    
    // Response flags
    setWaveRespV((prev) => [...prev, tempRespV ? 1 : 0]);
    setWaveRespA((prev) => [...prev, tempRespV ? tempResolvedPa : "Z"]);
    setWavePF((prev) => [...prev, tempPf ? 1 : 0]);
    setWavePrF((prev) => [...prev, tempPr ? 1 : 0]);
  };

  // Force single step execution of our hardware emulator state machine
  const handleStep = () => {
    // Current cycle increment
    const nextCycle = cycle + 1;
    setCycle(nextCycle);

    // Prepare temp variables to emulate synchronous edge assignments
    let nextState: MmuState = mmuState;
    let nextPtw: PtwState = ptwState;
    let nextRespV = false;
    let nextPa = resolvedPa;
    let tempPf = pageFault;
    let tempPr = protFault;

    // Convert address parameter to integer representation
    let vaNum = 0;
    try {
      vaNum = parseInt(vaInput, 16);
      if (isNaN(vaNum)) vaNum = 0x00403120;
    } catch {
      vaNum = 0x00403120;
    }

    if (mmuState === "IDLE") {
      setResolvedPa("--");
      setRespValid(false);
      setPageFault(false);
      setProtFault(false);
      setMemBusReq(false);
      setMemBusAddr("--");
      setMemBusReady(false);
      setActiveSet(null);
      setActiveWay(null);

      // CPU triggers requests
      setLatchedVa(vaNum);
      setLatchedUser(reqUser);
      setLatchedWrite(reqWrite);
      setLatchedExec(reqExec);

      if (!mmuEnable) {
        nextState = "SUCCESS";
        nextPa = "0x" + vaNum.toString(16).toUpperCase();
        nextRespV = true;
        addLog(`[BYPASS] MMU is disabled. Direct 1:1 Physical mapping. Translated VA: ${vaInput} -> PA: ${nextPa}`, "success");
      } else {
        nextState = "LOOKUP";
        addLog(`[CPU REQ] Virtual translation requested for VA: 0x${vaNum.toString(16).toUpperCase()}. Commencing TLB inspection.`, "info");
      }
    } 
    else if (mmuState === "LOOKUP") {
      const vpn = latchedVa >> 12;
      const idx = vpn & 0x3;
      const tag = vpn >> 2;

      setActiveSet(idx);
      addLog(`[TLB PROBE] Slicing VPN. Set Index = 0x${idx.toString(16).toUpperCase()} (VPN[1:0]), Matching Tag = 0x${tag.toString(16).toUpperCase()} (VPN[19:2]).`, "info");

      // Scan Ways
      let hitIdx: number | null = null;
      let matchedEntry: TlbEntry | null = null;

      for (let w = 0; w < 2; w++) {
        const entry = tlb_data[idx][w];
        if (entry.valid && entry.tag === tag && entry.asid === asid) {
          hitIdx = w;
          matchedEntry = entry;
          break;
        }
      }

      if (hitIdx !== null && matchedEntry) {
        setActiveWay(hitIdx);
        addLog(`[TLB HIT] Cached mapping detected in Way ${hitIdx} for Set ${idx}! Checking access permissions...`, "success");

        // Analyze Access Privileges and flags
        let accessViolation = false;
        let violationMsg = "";

        if (latchedUser && !matchedEntry.user) {
          accessViolation = true;
          violationMsg = "Privilege Level fault: User process accessing Supervisor-only page.";
        } else if (latchedWrite && !matchedEntry.write) {
          accessViolation = true;
          violationMsg = "Write Protection fault: Process attempting write on Write-Protected (Read-Only) page.";
        } else if (latchedExec && !matchedEntry.exec) {
          accessViolation = true;
          violationMsg = "Execution Protection fault: Instruction fetch issued on non-executable memory descriptor.";
        } else if (!latchedExec && !latchedWrite && !matchedEntry.read) {
          accessViolation = true;
          violationMsg = "Instruction Read protection violation.";
        }

        if (accessViolation) {
          nextState = "FAULT";
          tempPr = true;
          setProtFault(true);
          addLog(`[FAULT] ${violationMsg} Raising Protection Fault exception vector.`, "error");
        } else {
          nextState = "SUCCESS";
          const finalPaVal = (matchedEntry.ppn << 12) | (latchedVa & 0xFFF);
          nextPa = "0x" + finalPaVal.toString(16).toUpperCase();
          nextRespV = true;

          // Update LRU
          const updatedLru = [...lru_bits];
          updatedLru[idx] = 1 - hitIdx; // Opposed index is older now
          setLruBits(updatedLru);
          addLog(`[RESOLUTION] Verification succeeded! Physical address synthesized: ${nextPa}. LRU for Set ${idx} toggled to Way ${1 - hitIdx}.`, "success");
        }
      } else {
        // Cache Miss -> Transition to walking page trees
        nextState = "WALKING";
        nextPtw = "REQ_L1";
        addLog(`[TLB MISS] Mapping for VPN 0x${vpn.toString(16).toUpperCase()} absent in cache Set ${idx}. Booting Page Table Walker...`, "warn");
      }
    } 
    else if (mmuState === "WALKING") {
      const vpn1 = latchedVa >> 22;
      const vpn0 = (latchedVa >> 12) & 0x3FF;

      if (ptwState === "REQ_L1") {
        const l1Addr = (satpPpn << 12) + (vpn1 * 4);
        setMemBusReq(true);
        setMemBusAddr("0x" + l1Addr.toString(16).toUpperCase());
        setMemBusReady(false);
        nextPtw = "WAIT_L1";
        addLog(`[PTW L1] Formulating Level 1 PTE physical target: 0x${l1Addr.toString(16).toUpperCase()} [Base satp_ppn (0x${satpPpn.toString(16)}) + VPN1 index shift (0x${vpn1.toString(16)})]. Requesting read...`, "bus");
      } 
      else if (ptwState === "WAIT_L1") {
        setMemBusReady(true);
        // Simulate level-1 BRAM memory response on next edge
        let tempPte1 = 0;
        if (vpn1 === 1) {
          tempPte1 = (0x02000 << 12) | 0x01; // Points to table L2 base at PPN 0x02000, Valid=1
        } else if (vpn1 === 2) {
          tempPte1 = (0x03000 << 12) | 0x01; // Points to table L2 base at PPN 0x03000, Valid=1
        } else {
          tempPte1 = 0x00000000; // Unallocated
        }

        setL1Pte(tempPte1);
        addLog(`[MEM RESP] Bus received Level-1 descriptor word: 0x${tempPte1.toString(16).toUpperCase()}`, "bus");

        // Decode PTE1
        const isValid = (tempPte1 & 0x1) !== 0;
        const isLeaf = (tempPte1 & 0xE) !== 0; // R/W/X bits are occupied?

        if (!isValid) {
          nextState = "FAULT";
          nextPtw = "FAULT";
          tempPf = true;
          setPageFault(true);
          addLog(`[FAULT] Level 1 descriptor is invalid (V=0). Unmapped segment. Aborting walk with Page Fault.`, "error");
        } else if (isLeaf) {
          // Mega-page detected (We resolve instantly)
          setRefillVpn(latchedVa >> 12);
          setRefillPpn((tempPte1 >> 22) << 10 | vpn0); // Merge mega base with L2 offset
          setRefillPerms({
            user: (tempPte1 & 0x10) !== 0,
            read: (tempPte1 & 0x2) !== 0,
            write: (tempPte1 & 0x4) !== 0,
            exec: (tempPte1 & 0x8) !== 0
          });
          nextPtw = "REFILL";
          nextState = "REFILL";
          addLog(`[MegaPage] L1 leaf megadescriptor mapped! Base physical frames mapped. Fast forwarding walk to cache refill.`, "success");
        } else {
          // Moves downwards to L2 table base
          nextPtw = "REQ_L2";
          addLog(`[PTW L1] Valid L1 Entry found! Points to sub-table base PPN 0x${(tempPte1 >> 12).toString(16).toUpperCase()}. Proceeding to L2 walk.`, "info");
        }
      } 
      else if (ptwState === "REQ_L2") {
        const l2BasePpn = l1Pte >> 12;
        const l2Addr = (l2BasePpn << 12) + (vpn0 * 4);
        setMemBusReq(true);
        setMemBusAddr("0x" + l2Addr.toString(16).toUpperCase());
        setMemBusReady(false);
        nextPtw = "WAIT_L2";
        addLog(`[PTW L2] Formulating Level 2 PTE physical target: 0x${l2Addr.toString(16).toUpperCase()} [Base L1_PPN (0x${l2BasePpn.toString(16)}) + VPN0 index shift (0x${vpn0.toString(16)})]. Requesting read...`, "bus");
      } 
      else if (ptwState === "WAIT_L2") {
        setMemBusReady(true);
        const l2BasePpn = l1Pte >> 12;
        let tempPte2 = 0;

        if (l2BasePpn === 0x02000 && vpn0 === 3) {
          tempPte2 = (0x84000 << 12) | 0x17; // PPN=0x84000, V=1, R=1, W=1, U=1, X=0
        } else if (l2BasePpn === 0x03000 && vpn0 === 5) {
          tempPte2 = (0x95000 << 12) | 0x03; // PPN=0x95000, V=1, R=1, W=0, U=0, X=0 (RO, Supervisor)
        } else {
          tempPte2 = 0x00000000; // unallocated
        }

        setL2Pte(tempPte2);
        addLog(`[MEM RESP] Bus received Leaf Level-2 descriptor word: 0x${tempPte2.toString(16).toUpperCase()}`, "bus");

        const isValid = (tempPte2 & 0x1) !== 0;
        const isLeaf = (tempPte2 & 0xE) !== 0;

        if (!isValid || !isLeaf) {
          nextState = "FAULT";
          nextPtw = "FAULT";
          tempPf = true;
          setPageFault(true);
          addLog(`[FAULT] Level 2 leaf is invalid or unallocated. Walk aborted with Page Fault exception.`, "error");
        } else {
          setRefillVpn(latchedVa >> 12);
          setRefillPpn(tempPte2 >> 12);
          setRefillPerms({
            user: (tempPte2 & 0x10) !== 0,
            read: (tempPte2 & 0x2) !== 0,
            write: (tempPte2 & 0x4) !== 0,
            exec: (tempPte2 & 0x8) !== 0
          });
          nextPtw = "REFILL";
          nextState = "REFILL";
          addLog(`[PTW Decoded] Leaf resolved mapping successfully: VPN 0x${(latchedVa >> 12).toString(16)} -> PPN 0x${(tempPte2 >> 12).toString(16)}. Commencing cache write.`, "success");
        }
      }
    } 
    else if (mmuState === "REFILL") {
      const idx = refillVpn & 0x3;
      const wayToReplace = lru_bits[idx]; // Replace using LRU algorithm

      // Write-in
      const updatedTlb = [...tlb_data];
      updatedTlb[idx][wayToReplace] = {
        valid: true,
        user: refillPerms.user,
        read: refillPerms.read,
        write: refillPerms.write,
        exec: refillPerms.exec,
        tag: refillVpn >> 2,
        asid: asid,
        ppn: refillPpn,
        way: wayToReplace,
      };

      setTlbData(updatedTlb);

      const updatedLru = [...lru_bits];
      updatedLru[idx] = 1 - wayToReplace; // Other slot is older now
      setLruBits(updatedLru);

      nextState = "RETRY";
      nextPtw = "IDLE";
      addLog(`[REFILL WRITE] Overwriting Way ${wayToReplace} of Set ${idx} (using modern hardware LRU eviction). Retrying Translation...`, "info");
    } 
    else if (mmuState === "RETRY") {
      // Loopback retry
      nextState = "LOOKUP";
      addLog(`[RETRY] Relaunching lookup pipeline. VPN 0x${(latchedVa >> 12).toString(16)} is now warm inside the TLB registers.`, "info");
    } 
    else if (mmuState === "FAULT") {
      nextState = "IDLE";
      addLog(`[TB HANDSHAKE] Core exception acknowledged. Resetting line buses to Idle.`, "warn");
    } 
    else if (mmuState === "SUCCESS") {
      nextState = "IDLE";
      addLog(`[TB HANDSHAKE] Direct Physical mapping captured by CPU buffers. Resetting lines to Idle.`, "info");
    }

    // Set final updates
    setMmuState(nextState);
    setPtwState(nextPtw);
    setResolvedPa(nextPa);

    // Track waves data
    updateWaveformHistory(0, nextState, nextPtw, nextRespV, nextPa, tempPf, tempPr);
    setTimeout(() => {
      updateWaveformHistory(1, nextState, nextPtw, nextRespV, nextPa, tempPf, tempPr);
    }, 100);
  };

  // Run whole pipeline to completion
  const handleRunAll = () => {
    let limit = 20;
    const runInterval = setInterval(() => {
      if (mmuState === "IDLE" && limit !== 20) {
        clearInterval(runInterval);
      } else {
        handleStep();
        limit--;
        if (limit <= 0) clearInterval(runInterval);
      }
    }, 220);
  };

  // Clear tracking waves back to initial edge
  const handleResetWaveform = () => {
    setWaveClk([0]);
    setWaveReqV([0]);
    setWaveReqA([0]);
    setWaveBusy([0]);
    setWaveMemReq([0]);
    setWaveMemAddr([0]);
    setWaveMemReady([0]);
    setWaveHit([0]);
    setWaveRefill([0]);
    setWaveRespV([0]);
    setWaveRespA([0]);
    setWavePF([0]);
    setWavePrF([0]);
    addLog("Waveform tracing registers completely flushed.", "warn");
  };

  // Reset MMU State structures
  const handleResetMMU = () => {
    setCycle(0);
    setMmuState("IDLE");
    setPtwState("IDLE");
    setResolvedPa("--");
    setRespValid(false);
    setPageFault(false);
    setProtFault(false);
    setTlbData(createEmptyTlb());
    setLruBits([0, 0, 0, 0]);
    setLogs([]);
    handleResetWaveform();
    addLog("Full hardware cold-restart triggered. Register buffers initialized.", "warn");
  };

  // Load Mapping from visual preset
  const handleLoadPreset = (p: PresetMapping) => {
    handleResetMMU();
    setVaInput(p.va);
    setReqUser(p.user);
    setReqWrite(p.write);
    setReqExec(p.exec);
    addLog(`Preset mapped: [${p.name}]. Ready for clock edge stepping.`, "info");
  };

  return (
    <div className="min-h-screen bg-[#020408] text-slate-100 flex flex-col font-sans">
      {/* Header Banner */}
      <header className="border-b border-[#ffffff11] bg-[#0a0f1d]/85 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-[#0a0f1d] border border-[#ff00e5] flex items-center justify-center shadow-[0_0_15px_rgba(255,0,229,0.3)]">
            <Cpu className="w-5 h-5 text-[#ff00e5] animate-pulse" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-mono font-black tracking-tight bg-gradient-to-r from-[#00f2ff] via-[#ff00e5] to-[#39ff14] bg-clip-text text-transparent uppercase">
              Memory Management Unit (MMU) VLSI Sandbox
            </h1>
            <p className="text-[10px] text-[#00f2ff] font-mono">
              Academic course project verification environment — parametric RTL modeling
            </p>
          </div>
        </div>

        {/* Tab Selection */}
        <nav className="flex items-center bg-[#050914] p-1 rounded border border-[#ffffff11] gap-1 select-none shrink-0 font-mono text-xs">
          <button
            onClick={() => setActiveTab("workspace")}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "workspace"
                ? "bg-[#00f2ff]/10 text-[#00f2ff] border border-[#00f2ff55] font-black"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            VIRTUAL LAB
          </button>
          <button
            onClick={() => setActiveTab("codebase")}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "codebase"
                ? "bg-[#ff00e5]/10 text-[#ff00e5] border border-[#ff00e555] font-black"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            SYNTHESIS & RTL
          </button>
          <button
            onClick={() => setActiveTab("aitutor")}
            className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "aitutor"
                ? "bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff1455] font-black"
                : "text-slate-400 hover:text-[#39ff14]"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI HARDWARE TUTOR
          </button>
        </nav>
      </header>

      {/* Main Sandbox Layout */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {activeTab === "workspace" && (
          <>
            {/* Split Screen Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: CPU inputs + Controls + Active state flow diagram (Lg: col-span-5) */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Micro-Controller Control panel */}
                <div className="bg-[#0a0f1d] border border-[#00f2ff33] rounded-lg p-5 shadow-[0_0_15px_rgba(0,242,255,0.05)] relative overflow-hidden">
                  <div className="flex items-center gap-2 mb-4 border-b border-[#ffffff11] pb-2.5">
                    <Compass className="w-4.5 h-4.5 text-[#00f2ff]" />
                    <h2 className="font-mono text-xs font-black text-white uppercase tracking-wider">
                      Translation Input stimulators
                    </h2>
                  </div>

                  {/* Registers configurations inputs */}
                  <div className="space-y-4 font-mono text-xs">
                    {/* Enable Bypass switches */}
                    <div className="flex items-center justify-between pb-3.5 border-b border-[#ffffff11]">
                      <div className="text-left">
                        <span className="text-slate-300 block font-bold">Translation Mode (satp.mode)</span>
                        <span className="text-[10px] text-slate-500 leading-none">Bypass active mapping if disabled</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={mmuEnable}
                          onChange={(e) => setMmuEnable(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-5 bg-[#020408] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-500 peer-checked:after:bg-[#00f2ff] after:border-none after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#00f2ff]/10 border border-[#ffffff11] peer-checked:border-[#00f2ff]/40"></div>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 pt-1">
                      {/* ASID input */}
                      <div>
                        <label className="text-slate-400 block mb-1 text-left">Address Space ID (ASID):</label>
                        <select
                          value={asid}
                          onChange={(e) => setAsid(Number(e.target.value))}
                          className="w-full bg-[#020408] border border-[#ffffff11] text-[#ff00e5] font-bold rounded px-2' py-1.5 focus:outline-none focus:border-[#ff00e5]/50 px-2.5 py-2 text-[11px]"
                        >
                          <option value={0x5F}>0x5F (Target User Process)</option>
                          <option value={0xA1}>0xA1 (Supervisor task)</option>
                          <option value={0xFF}>0xFF (Global Kernel ASID)</option>
                        </select>
                      </div>

                      {/* SATP Base Table Pointer */}
                      <div>
                        <label className="text-slate-400 block mb-1 text-left">Root Table PPN (SATP):</label>
                        <input
                          type="text"
                          value="0x01000"
                          disabled
                          className="w-full bg-[#020408]/60 border border-[#ffffff11] text-[#39ff14] font-bold rounded px-2.5 py-2 text-[11px] opacity-80"
                        />
                      </div>
                    </div>

                    {/* Virtual Address Input & type */}
                    <div className="pt-2 border-t border-[#ffffff11]">
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-slate-400 block text-left">Virtual Address (VA 32-bit):</label>
                        <span className="text-[10px] text-slate-500 font-bold uppercase">4KB Paged aligning</span>
                      </div>
                      <input
                        type="text"
                        value={vaInput}
                        onChange={(e) => setVaInput(e.target.value)}
                        placeholder="e.g. 0x00403120"
                        className="w-full bg-[#020408] text-[#00f2ff] font-bold border border-[#ffffff11] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#00f2ff]/50"
                      />
                    </div>

                    {/* Checkboxes parameters */}
                    <div className="grid grid-cols-3 gap-2 py-2">
                      <label className="flex items-center gap-1.5 bg-[#020408] p-1.5 px-2.5 rounded border border-[#ffffff11] text-left select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reqUser}
                          onChange={(e) => setReqUser(e.target.checked)}
                          className="accent-[#ff00e5] shrink-0"
                        />
                        <span>Usermode</span>
                      </label>
                      <label className="flex items-center gap-1.5 bg-[#020408] p-1.5 px-2.5 rounded border border-[#ffffff11] text-left select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reqWrite}
                          onChange={(e) => setReqWrite(e.target.checked)}
                          className="accent-[#00f2ff] shrink-0"
                        />
                        <span>Write (W)</span>
                      </label>
                      <label className="flex items-center gap-1.5 bg-[#020408] p-1.5 px-2.5 rounded border border-[#ffffff11] text-left select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reqExec}
                          onChange={(e) => setReqExec(e.target.checked)}
                          className="accent-[#ff00e5] shrink-0"
                        />
                        <span>Exec (X)</span>
                      </label>
                    </div>

                    {/* Control Buttons */}
                    <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-[#ffffff11]">
                      <button
                        onClick={handleResetMMU}
                        className="bg-[#020408] hover:bg-[#ffffff05] border border-[#ffffff11] text-slate-400 py-2 rounded transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                        RESET
                      </button>
                      <button
                        onClick={handleStep}
                        className="bg-[#00f2ff]/10 hover:bg-[#00f2ff]/20 border border-[#00f2ff55] text-[#00f2ff] py-2 rounded transition flex items-center justify-center gap-1 cursor-pointer font-bold shrink-0"
                      >
                        <SkipForward className="w-3.5 h-3.5 text-[#00f2ff]" />
                        TICK CLK
                      </button>
                      <button
                        onClick={handleRunAll}
                        className="bg-[#39ff14] hover:bg-[#39ff14]/85 text-black py-2 rounded font-black transition flex items-center justify-center gap-1 cursor-pointer shadow-[0_0_15px_rgba(57,255,20,0.3)] border border-[#39ff14]/30"
                      >
                        <Play className="w-3.5 h-3.5 text-black" />
                        RUN ALL
                      </button>
                    </div>
                  </div>
                </div>

                {/* Educational Presets list */}
                <div className="bg-[#0a0f1d] border border-[#ff00e533] rounded-lg p-5 shadow-[0_0_15px_rgba(255,0,229,0.05)] relative overflow-hidden">
                  <span className="text-[10px] font-bold text-[#ff00e5] font-mono block mb-2 uppercase tracking-wide">
                    Academic Lab verification scenarios:
                  </span>
                  <div className="space-y-2">
                    {PRESETS.map((p, pIdx) => {
                      const isActivePreset = vaInput === p.va && reqUser === p.user && reqWrite === p.write && reqExec === p.exec;
                      return (
                        <button
                          key={pIdx}
                          onClick={() => handleLoadPreset(p)}
                          className={`w-full text-left p-3 rounded border text-xs font-mono transition flex flex-col justify-start gap-1 cursor-pointer ${
                            isActivePreset
                              ? "bg-[#ff00e5]/10 border-[#ff00e5aa] text-white"
                              : "bg-[#020408] border-[#ffffff11] text-slate-400 hover:bg-[#0a0f1d] hover:text-white"
                          }`}
                        >
                          <span className="font-extrabold text-[#edf2f7] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded bg-[#00f2ff] inline-block shrink-0"></span>
                            {p.name}
                          </span>
                          <p className="text-[10px] text-slate-500 leading-tight">
                            {p.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-[9px] text-[#e2e8f0]/80">
                            <span className="bg-[#020408] px-1.5 py-0.5 rounded border border-[#ffffff11]">
                              VA: <strong className="text-[#00f2ff]">{p.va}</strong>
                            </span>
                            <span className="bg-[#020408] px-1.5 py-0.5 rounded border border-[#ffffff11]">
                              Mode: <strong className="text-[#ff00e5]">{p.user ? "User" : "Supr"}</strong>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Visual pipeline flow charts + active output indicators (Lg: col-span-7) */}
              <div className="lg:col-span-7 space-y-6">
                {/* Active Bus Output indicators */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* P address output */}
                  <div className={`p-4 rounded border bg-[#0a0f1d] font-mono text-center flex flex-col items-center justify-center shadow-md relative overflow-hidden transition-all ${
                    respValid ? (pageFault || protFault ? "border-[#ff00e5] shadow-glow-pink" : "border-[#39ff14] shadow-glow-green") : "border-[#ffffff11]"
                  }`}>
                    {pageFault || protFault ? (
                      <ShieldAlert className="w-4 h-4 text-[#ff00e5] absolute top-2 right-2 animate-bounce" />
                    ) : respValid ? (
                      <Award className="w-4 h-4 text-[#39ff14] absolute top-2 right-2 animate-pulse" />
                    ) : null}
                    
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Physical PA</span>
                    <strong className={`text-lg block mt-1 font-extrabold ${
                      respValid ? (pageFault || protFault ? "text-[#ff00e5]" : "text-[#39ff14]") : "text-slate-400"
                    }`}>
                      {resolvedPa}
                    </strong>
                  </div>

                  {/* MMU state */}
                  <div className="p-4 rounded border border-[#ffffff11] bg-[#0a0f1d] font-mono text-center flex flex-col items-center justify-center shadow-md">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">MMU pipeline</span>
                    <strong className="text-md block mt-1.5 text-[#00f2ff] uppercase tracking-widest font-extrabold animate-pulse">
                      {mmuState}
                    </strong>
                  </div>

                  {/* PTW State */}
                  <div className="p-4 rounded border border-[#ffffff11] bg-[#0a0f1d] font-mono text-center flex flex-col items-center justify-center shadow-md">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Walker (PTW)</span>
                    <strong className="text-md block mt-1.5 text-amber-500 uppercase tracking-widest font-extrabold">
                      {ptwState}
                    </strong>
                  </div>

                  {/* Simulation Cycle counter */}
                  <div className="p-4 rounded border border-[#ffffff11] bg-[#0a0f1d] font-mono text-center flex flex-col items-center justify-center shadow-md">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">CLK cycles</span>
                    <strong className="text-lg block mt-1 font-black text-white">
                      #{cycle}
                    </strong>
                  </div>
                </div>

                {/* PTW State Machine diagram */}
                <div className="bg-[#0a0f1d] border border-[#ff00e533] rounded-lg p-5 shadow-[0_0_15px_rgba(255,0,229,0.05)] relative overflow-hidden flex flex-col justify-between h-[360px]">
                  <div className="flex items-center justify-between border-b border-[#ffffff11] pb-2.5">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4.5 h-4.5 text-[#ff00e5]" />
                      <h3 className="font-mono text-xs font-black text-white uppercase tracking-wider">
                        Page Table Walker (PTW) Logic Diagram
                      </h3>
                    </div>
                    {memBusReq && (
                      <span className="text-[9px] bg-[#ff00e5]/10 border border-[#ff00e544] text-[#ff00e5] px-2.5 py-0.5 rounded font-mono animate-pulse font-bold">
                        BUS REQ: <strong>{memBusAddr}</strong>
                      </span>
                    )}
                  </div>

                  {/* Visual flowchart representation */}
                  <div className="flex-1 flex flex-col md:flex-row items-center justify-center gap-3.5 md:gap-2.5 py-4 font-mono text-[10px] relative">
                    
                    {/* State: IDLE */}
                    <div className={`p-2.5 rounded border flex flex-col items-center transition-all duration-300 w-24 ${
                      ptwState === "IDLE" ? "bg-[#00f2ff]/10 border-[#00f2ff] shadow-glow-cyan text-white font-bold" : "bg-[#020408] border-[#ffffff11] text-slate-500"
                    }`}>
                      <span className="font-bold">IDLE</span>
                      <span className="text-[8px] opacity-75">Awaiting trigger</span>
                    </div>

                    <ArrowRight className={`hidden md:block w-4 h-4 ${ptwState === "REQ_L1" || ptwState === "WAIT_L1" ? "text-[#ff00e5]" : "text-slate-800"}`} />

                    {/* State: L1 Lookup */}
                    <div className={`p-2.5 rounded border flex flex-col items-center transition-all duration-300 w-28 ${
                      ptwState === "REQ_L1" || ptwState === "WAIT_L1" ? "bg-[#ff00e5]/10 border-[#ff00e5] shadow-glow-pink text-white font-bold" : "bg-[#020408] border-[#ffffff11] text-slate-500"
                    }`}>
                      <span className="font-bold uppercase leading-none">Level 1 Walk</span>
                      <span className="text-[8px] opacity-80 mt-1">SATP Root PPN</span>
                    </div>

                    <ArrowRight className={`hidden md:block w-4 h-4 ${ptwState === "REQ_L2" || ptwState === "WAIT_L2" ? "text-[#ff00e5]" : "text-slate-800"}`} />

                    {/* State: L2 Lookup */}
                    <div className={`p-2.5 rounded border flex flex-col items-center transition-all duration-300 w-28 ${
                      ptwState === "REQ_L2" || ptwState === "WAIT_L2" ? "bg-[#ff00e5]/10 border-[#ff00e5] shadow-glow-pink text-white font-bold" : "bg-[#020408] border-[#ffffff11] text-slate-500"
                    }`}>
                      <span className="font-bold uppercase leading-none">Level 2 Walk</span>
                      <span className="text-[8px] opacity-80 mt-1">PTE Leaf Descriptor</span>
                    </div>

                    <ArrowRight className={`hidden md:block w-4 h-4 ${ptwState === "REFILL" ? "text-[#39ff14]" : "text-slate-800"}`} />

                    {/* State: REFILL cache */}
                    <div className={`p-2.5 rounded border flex flex-col items-center transition-all duration-300 w-24 ${
                      ptwState === "REFILL" ? "bg-[#39ff14]/10 border-[#39ff14] shadow-glow-green text-white font-bold" : "bg-[#020408] border-[#ffffff11] text-slate-500"
                    }`}>
                      <span className="font-bold uppercase">REFILL</span>
                      <span className="text-[8px] opacity-80">RTL Cache load</span>
                    </div>

                    {/* Fault Sub-State Floating */}
                    {(ptwState === "FAULT" || pageFault) && (
                      <div className="absolute bottom-2 bg-[#ff00e5]/20 border border-[#ff00e5] px-4 py-2 rounded shadow-glow-pink flex items-center justify-center gap-2 text-white animate-pulse font-mono font-bold text-[11px]">
                        <ShieldAlert className="w-4 h-4 text-[#ff00e5]" /> WALK COMPLETED WITH PAGE FAULT (Descriptor unallocated)
                      </div>
                    )}
                  </div>

                  {/* Exception flags status indicators */}
                  <div className="border-t border-[#ffffff11] pt-3 flex flex-wrap gap-4 items-center justify-between font-mono text-xs">
                    <div className="flex gap-4">
                      {/* Flag fault: page fault */}
                      <span className={`flex items-center gap-1.5 ${pageFault ? "text-[#ff00e5] font-bold" : "text-slate-600"}`}>
                        <ShieldAlert className="w-4 h-4" /> page_fault: <strong>{pageFault ? "1" : "0"}</strong>
                      </span>
                      {/* Flag fault: protection fault */}
                      <span className={`flex items-center gap-1.5 ${protFault ? "text-[#ff00e5] font-bold" : "text-slate-600"}`}>
                        <FolderLock className="w-4 h-4" /> prot_fault: <strong>{protFault ? "1" : "0"}</strong>
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 italic">
                      Traverse protocol compliant with RISC SV32 spec
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* TLB registers representation */}
            <TlbMonitor
              tlbData={tlb_data}
              lruBits={lru_bits}
              activeSet={activeSet}
              activeWay={activeWay}
              currentAsid={asid}
            />

            {/* Simulated Main Memory Page-Table collapsable explorer */}
            <div className="bg-[#0a0f1d] border border-[#00f2ff33] rounded-lg p-5 shadow-[0_0_15px_rgba(0,242,255,0.05)] relative overflow-hidden font-mono">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#ffffff11]">
                <BookMarked className="w-4.5 h-4.5 text-[#00f2ff]" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Emulated Physical Main Memory Map (Page Tables)
                </h3>
              </div>
              <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
                Represents physical RAM structure modeled inside the Verilog testbench. The top-level root Level-1 directory has satp pointer pointing to base address 0x01000000, which translates segments targeting sub-tables Bases at Physical addresses 0x02000000 and 0x03000000.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px]">
                {/* Tables L1 definition block */}
                <div className="bg-[#050914] p-3.5 rounded border border-[#ffffff11] space-y-2">
                  <span className="text-[10px] font-bold block border-b border-[#ffffff11] pb-1.5 uppercase text-[#ff00e5]">
                    SATP Root L1 Directory (0x01000000)
                  </span>
                  <div className="space-y-1.5 text-slate-400">
                    <div className="flex justify-between">
                      <span>Index 1 (VA_VPN1=1):</span>
                      <span className="text-white font-bold">0x02000001 (PPN: 0x02000)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Index 2 (VA_VPN1=2):</span>
                      <span className="text-white font-bold">0x03000001 (PPN: 0x03000)</span>
                    </div>
                    <div className="flex justify-between text-slate-650 italic">
                      <span>Index * (Other VPN1):</span>
                      <span className="text-slate-600">0x00000000 (Invalid - PF)</span>
                    </div>
                  </div>
                </div>

                {/* Sub table Base A */}
                <div className="bg-[#050914] p-3.5 rounded border border-[#ffffff11] space-y-2">
                  <span className="text-[10px] font-bold block border-b border-[#ffffff11] pb-1.5 uppercase text-[#00f2ff]">
                    Sub-Table Base A (PPN: 0x02000)
                  </span>
                  <div className="space-y-1.5 text-slate-400">
                    <div className="flex justify-between text-slate-400">
                      <span>Index 3 (VA_VPN0=3):</span>
                      <span className="text-cyan-400 font-bold">0x84000017 (PPN: 0x84000)</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Perm Flags:</span>
                      <span className="text-emerald-450">Valid=1, User=1, Read=1, Write=1</span>
                    </div>
                    <div className="flex justify-between text-slate-650 italic leading-none pt-1">
                      <span>Index * (Other VPN0):</span>
                      <span>0x00000000 (Invalid - PF)</span>
                    </div>
                  </div>
                </div>                {/* Sub table Base B */}
                <div className="bg-[#050914] p-3.5 rounded border border-[#ffffff11] space-y-2">
                  <span className="text-[10px] font-bold block border-b border-[#ffffff11] pb-1.5 uppercase text-[#ff00e5]">
                    Sub-Table Base B (PPN: 0x03000)
                  </span>
                  <div className="space-y-1.5 text-slate-400">
                    <div className="flex justify-between text-slate-450">
                      <span>Index 5 (VA_VPN0=5):</span>
                      <span className="text-[#ff00e5] font-bold">0x95000003 (PPN: 0x95000)</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Perm Flags:</span>
                      <span className="text-[#39ff14] font-bold">Valid=1, User=0 (Super), Read=1, Write=0</span>
                    </div>
                    <div className="flex justify-between text-slate-605 italic leading-none pt-1">
                      <span>Index * (Other VPN0):</span>
                      <span className="text-slate-600">0x00000000 (Invalid - PF)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Dynamic Waveform Analysis */}
            <WaveformViewer
              signals={[
                { name: "clk", type: "clock", color: "#00f2ff", history: waveClk },
                { name: "req_valid", type: "binary", color: "#39ff14", history: waveReqV },
                { name: "req_addr", type: "bus", color: "#00f2ff", history: waveReqA },
                { name: "mmu_busy", type: "binary", color: "#ff00e5", history: waveBusy },
                { name: "mem_req", type: "binary", color: "#ff00e5", history: waveMemReq },
                { name: "mem_ready", type: "binary", color: "#39ff14", history: waveMemReady },
                { name: "mem_addr", type: "bus", color: "#ff00e5", history: waveMemAddr },
                { name: "tlb_hit", type: "binary", color: "#39ff14", history: waveHit },
                { name: "refill_en", type: "binary", color: "#00f2ff", history: waveRefill },
                { name: "resp_valid", type: "binary", color: "#39ff14", history: waveRespV },
                { name: "resp_addr", type: "bus", color: "#ff00e5", history: waveRespA },
                { name: "page_fault", type: "binary", color: "#ff00e5", history: wavePF },
                { name: "prot_fault", type: "binary", color: "#ff00e5", history: wavePrF },
              ]}
              currentCycle={cycle}
              onResetWaveform={handleResetWaveform}
            />

            {/* Live Step logs */}
            <div className="bg-[#0a0f1d] border border-[#00f2ff33] rounded-lg p-5 shadow-[0_0_15px_rgba(0,242,255,0.05)] relative overflow-hidden font-mono">
              <span className="text-[10px] font-bold text-slate-400 block mb-3 uppercase tracking-wide">
                Simulation Console logs ({logs.length} transitions)
              </span>
              <div className="max-h-[220px] overflow-y-auto space-y-1.5 style-scrollbar text-[11px] pr-2">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic text-center py-4 text-xs">
                    Console ready. Click Step or Run All to dispatch clocks.
                  </div>
                ) : (
                  logs.slice().reverse().map((log, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 pb-1.5 border-b border-[#ffffff11]"
                    >
                      <span className="text-slate-500 font-bold shrink-0">[{log.timestamp}]</span>
                      <span className="text-slate-500 shrink-0 select-all">Cycle #{log.cycle}</span>
                      <span className={`font-bold shrink-0 w-20 text-center rounded px-1.5 text-[10px] ${
                        log.type === "success"
                          ? "bg-[#39ff14]/10 text-[#39ff14]"
                          : log.type === "warn"
                          ? "bg-amber-950/40 text-amber-500"
                          : log.type === "error"
                          ? "bg-[#ff00e5]/10 text-[#ff00e5]"
                          : log.type === "bus"
                          ? "bg-[#00f2ff]/10 text-[#00f2ff]"
                          : "bg-[#020408] text-slate-400"
                      }`}>
                        {log.type.toUpperCase()}
                      </span>
                      <span className="text-[#edf2f7] text-left">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === "codebase" && <CodeExplorer />}

        {activeTab === "aitutor" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8">
              <AiTutor />
            </div>

            {/* Side instructions summary helper */}
            <div className="lg:col-span-4 bg-[#0a0f1d] border border-[#ff00e533] rounded-lg p-5 shadow-[0_0_15px_rgba(255,0,229,0.05)] relative overflow-hidden font-mono text-xs">
              <span className="text-[10px] font-bold text-slate-400 block mb-3 uppercase tracking-wide flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-[#ff00e5]" /> Homework Laboratory Prompts
              </span>
              <p className="text-slate-450 leading-relaxed mb-4">
                Ask your Virtual VLSI Architect to explain core parts of the project, including:
              </p>
              
              <ul className="space-y-3.5 text-slate-300 pr-2">
                <li className="flex gap-2">
                  <span className="text-[#ff00e5] font-black shrink-0">1.</span>
                  <span>How the two-way set-associative tag array utilizes <strong>asid_array</strong> comparisons to secure processes.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#00f2ff] font-black shrink-0">2.</span>
                  <span>Reviewing the finite states inside <strong>ptw.v</strong> and explaining transition conditions.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#39ff14] font-black shrink-0">3.</span>
                  <span>Explaining critical paths of combinational lookups in synthesized standard standard gate CMOS cells.</span>
                </li>
              </ul>

              <div className="mt-5 pt-4 border-t border-[#ffffff11] text-[10px] text-slate-500">
                To run Yosys, execute <code>yosys yosys_synth.ys</code> inside your university Unix environment.
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer copyright */}
      <footer className="border-t border-[#ffffff11] bg-[#020408] py-6 px-6 text-center text-xs text-slate-500 font-mono flex flex-col sm:flex-row items-center justify-between gap-4 max-w-7xl mx-auto w-full">
        <p>© 2026 Memory Management Unit (MMU) Verilog HDL course project. Verified Synthesizable.</p>
        <p className="flex items-center gap-1 text-[10px] text-[#00f2ff] bg-[#00f2ff]/10 border border-[#00f2ff33] px-2.5 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00f2ff] inline-block animate-pulse"></span>
          Simulated Virtual Implementation
        </p>
      </footer>
    </div>
  );
}
