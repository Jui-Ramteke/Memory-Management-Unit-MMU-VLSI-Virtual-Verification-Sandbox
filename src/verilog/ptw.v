// =========================================================================
// Title: Page Table Walker (PTW) for 2-Level Virtual Memory Support
// Description: Implements a hardware page-table traversal mechanism. 
//              Traverses Level-1 (L1) and Level-2 (L2) page tables
//              from memory to resolve virtual-to-physical mapping.
// =========================================================================

`timescale 1ns / 1ps

module ptw (
    input  wire         clk,
    input  wire         rst_n,
    
    // Control interface from top-level MMU
    input  wire         start_walk,
    input  wire [31:0]  fault_va,       // Virtual address causing the miss
    input  wire [19:0]  satp_ppn,       // Page Table Root PPN from supervisor register
    
    output reg          busy,           // Walking in progress
    output reg          walk_done,      // Traversal succeeded
    output reg          walk_fault,     // Page fault (unmapped/invalid entry)
    
    // Outputs to refill the TLB
    output reg [19:0]   refill_vpn,
    output reg [19:0]   refill_ppn,
    output reg [4:0]    refill_perms,   // {V, U, R, W, X}
    
    // Memory Interface (Simple Synchronous Bus)
    output reg          mem_req,
    output reg [31:0]   mem_addr,
    input  wire [31:0]  mem_rdata,
    input  wire         mem_ready
);

    // States definition
    localparam STATE_IDLE     = 3'd0;
    localparam STATE_REQ_L1   = 3'd1;
    localparam STATE_WAIT_L1  = 3'd2;
    localparam STATE_REQ_L2   = 3'd3;
    localparam STATE_WAIT_L2  = 3'd4;
    localparam STATE_REFILL   = 3'd5;
    localparam STATE_FAULT    = 3'd6;

    reg [2:0] current_state, next_state;

    // Registers to latch addresses and intermediary descriptors
    reg [31:0] latched_va;
    reg [31:0] l1_pte;
    reg [31:0] l2_pte;

    // Extract fields from virtual address
    // 32-bit Virtual Address:
    // [31:22] - VPN1 (Level 1 Page Table Index, 10 bits)
    // [21:12] - VPN0 (Level 2 Page Table Index, 10 bits)
    // [11:0]  - Offset (12 bits)
    wire [9:0] vpn1 = latched_va[31:22];
    wire [9:0] vpn0 = latched_va[21:12];

    // Decode flags of PTE:
    // Format: PPN[31:12], Flags[11:0]
    // Standard layout: { [PPN 20-bit], [Unused 7-bit], User[4], Exec[3], Write[2], Read[1], Valid[0] }
    // Thus flags fields are:
    // V = PTE[0] (Valid)
    // R = PTE[1] (Read)
    // W = PTE[2] (Write)
    // X = PTE[3] (Execute)
    // U = PTE[4] (User)

    // State Transition Logic
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            current_state <= STATE_IDLE;
            latched_va    <= 32'b0;
            l1_pte        <= 32'b0;
            l2_pte        <= 32'b0;
        end else begin
            current_state <= next_state;
            
            if (current_state == STATE_IDLE && start_walk) begin
                latched_va <= fault_va;
            end
            
            if (current_state == STATE_WAIT_L1 && mem_ready) begin
                l1_pte <= mem_rdata;
            end
            
            if (current_state == STATE_WAIT_L2 && mem_ready) begin
                l2_pte <= mem_rdata;
            end
        end
    end

    // Next State combinational logic
    always @(*) begin
        next_state = current_state;
        
        case (current_state)
            STATE_IDLE: begin
                if (start_walk) begin
                    next_state = STATE_REQ_L1;
                end
            end
            
            STATE_REQ_L1: begin
                next_state = STATE_WAIT_L1;
            end
            
            STATE_WAIT_L1: begin
                if (mem_ready) begin
                    // Check Level 1 Page Table Entry
                    // If not valid: Page fault
                    if (!mem_rdata[0]) begin
                        next_state = STATE_FAULT;
                    end
                    // If translation leaf (Read/Write/Execute bits are set): megapage support
                    else if (mem_rdata[1] || mem_rdata[2] || mem_rdata[3]) begin
                        next_state = STATE_REFILL; // Leaf Megapage resolved
                    end
                    // Otherwise, pointer to next level page table
                    else begin
                        next_state = STATE_REQ_L2;
                    end
                end
            end
            
            STATE_REQ_L2: begin
                next_state = STATE_WAIT_L2;
            end
            
            STATE_WAIT_L2: begin
                if (mem_ready) begin
                    // Check Level 2 Page Table Entry
                    // If not valid, or not a leaf entry -> Page fault
                    if (!mem_rdata[0] || (!mem_rdata[1] && !mem_rdata[2] && !mem_rdata[3])) begin
                        next_state = STATE_FAULT;
                    end else begin
                        next_state = STATE_REFILL;
                    end
                end
            end
            
            STATE_REFILL: begin
                next_state = STATE_IDLE;
            end
            
            STATE_FAULT: begin
                next_state = STATE_IDLE;
            end
            
            default: next_state = STATE_IDLE;
        endcase
    end

    // Output Port Assignments
    always @(*) begin
        busy         = (current_state != STATE_IDLE);
        walk_done    = (current_state == STATE_REFILL);
        walk_fault   = (current_state == STATE_FAULT);
        
        // Memory signals
        mem_req      = 1'b0;
        mem_addr     = 32'b0;
        
        // Refill signals
        refill_vpn   = latched_va[31:12];
        refill_ppn   = 20'b0;
        refill_perms = 5'b0;
        
        case (current_state)
            STATE_REQ_L1, STATE_WAIT_L1: begin
                mem_req  = 1'b1;
                // L1 table base is {satp_ppn, 12'b0}. Indices are VPN1.
                // Each descriptor occupies 4 bytes (offset = VPN1 * 4).
                mem_addr = {satp_ppn, 12'b0} + {20'b0, vpn1, 2'b0};
            end
            
            STATE_REQ_L2, STATE_WAIT_L2: begin
                mem_req  = 1'b1;
                // Next level base is PPN of L1 PTE. Indices are VPN0.
                mem_addr = {l1_pte[31:12], 12'b0} + {20'b0, vpn0, 2'b0};
            end
            
            STATE_REFILL: begin
                // Check if Megapage leaf or L2 leaf
                if (l1_pte[1] || l1_pte[2] || l1_pte[3]) begin
                    // Megapage leaf (level 1 leaf)
                    // The VPN0 is integrated into physical frame offset
                    refill_ppn   = {l1_pte[31:22], vpn0};
                    refill_perms = {l1_pte[0], l1_pte[4], l1_pte[1], l1_pte[2], l1_pte[3]}; // V, U, R, W, X
                end else begin
                    // Regular 4KB Page resolved
                    refill_ppn   = l2_pte[31:12];
                    refill_perms = {l2_pte[0], l2_pte[4], l2_pte[1], l2_pte[2], l2_pte[3]}; // V, U, R, W, X
                end
            end
            
            default: ;
        endcase
    end

endmodule
