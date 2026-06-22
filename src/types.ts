// =========================================================================
// Title: TypeScript Type Declarations for MMU Verilog Simulator
// Description: Centralizes type models for TLB structures, walk states,
//              waveform tracking, and coding assets.
// =========================================================================

export interface TlbEntry {
  valid: boolean;
  user: boolean;
  read: boolean;
  write: boolean;
  exec: boolean;
  tag: number;   // 18 bits
  asid: number;  // 8 bits
  ppn: number;   // 20 bits
  way: number;   // 0 or 1
}

export type PtwState = 
  | "IDLE" 
  | "REQ_L1" 
  | "WAIT_L1" 
  | "REQ_L2" 
  | "WAIT_L2" 
  | "REFILL" 
  | "FAULT";

export type MmuState = 
  | "IDLE" 
  | "LOOKUP" 
  | "WALKING" 
  | "RETRY" 
  | "FAULT" 
  | "SUCCESS"
  | "REFILL";

export interface SimulationStepLog {
  cycle: number;
  state: MmuState;
  ptwState: PtwState;
  message: string;
  type: "info" | "success" | "warn" | "error" | "bus";
  timestamp: string;
}

export interface WaveSignal {
  name: string;
  type: "clock" | "bus" | "control" | "flag" | "address";
  values: (number | string)[]; // array showing values at successive cycles
}

export interface VerilogFile {
  id: string;
  name: string;
  language: string;
  description: string;
  content?: string; // Loaded dynamically or statically
}

export interface PresetMapping {
  name: string;
  va: string;
  user: boolean;
  write: boolean;
  exec: boolean;
  description: string;
  expectedResult: string;
}
