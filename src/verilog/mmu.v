// =========================================================================
// Title: Top-level Memory Management Unit (MMU) Module
// Description: Connects the TLB and Page Table Walker (PTW) modules. 
//              Coordinates lookups, refills, and translation states. Handles
//              fault generation for Page Faults (unmapped) and Protection Faults.
// =========================================================================

`timescale 1ns / 1ps

module mmu (
    input  wire         clk,
    input  wire         rst_n,
    
    // Configuration Inputs
    input  wire         enable,          // 1 = VM Translate enabled, 0 = Bypassed (Physical = Virtual)
    input  wire [7:0]   asid,            // Current Address Space ID
    input  wire [19:0]  satp_ppn,        // Root Page Table Physical Page Number
    
    // CPU translation Request
    input  wire         req_valid,
    input  wire [31:0]  req_addr,        // Virtual address to translate
    input  wire         req_user,        // 1 = User privilege, 0 = Supervisor
    input  wire         req_write,       // Write request
    input  wire         req_execute,     // Execute (Instruction fetch) request
    
    // CPU translation Response
    output reg          resp_valid,
    output reg  [31:0]  resp_addr,       // Translated physical address
    output reg          page_fault,      // Page Fault exception (PTE invalid)
    output reg          prot_fault,      // Protection Fault exception (Access violation)
    output reg          mmu_busy,        // MMU is busy and cannot take new requests
    
    // Memory Interface (passed from PTW)
    output wire         mem_req,
    output wire [31:0]  mem_addr,
    input  wire [31:0]  mem_rdata,
    input  wire         mem_ready,
    
    // Invalidation command
    input  wire         flush_all
);

    // MMU States
    localparam MMU_STATE_IDLE    = 3'd0;
    localparam MMU_STATE_LOOKUP  = 3'd1;
    localparam MMU_STATE_WALKING = 3'd2;
    localparam MMU_STATE_RETRY   = 3'd3;
    localparam MMU_STATE_FAULT   = 3'd4;
    localparam MMU_STATE_SUCCESS = 3'd5;

    reg [2:0] mmu_state, next_mmu_state;

    // Registers to latch translation request
    reg [31:0] latched_va;
    reg        latched_user;
    reg        latched_write;
    reg        latched_exec;

    // TLB Interconnects
    reg        tlb_lookup_en;
    wire       tlb_hit;
    wire [19:0]tlb_ppn;
    wire       tlb_fault_prot;
    
    wire       refill_en;
    wire [19:0]refill_vpn;
    wire [19:0]refill_ppn;
    wire [4:0] refill_perms;

    // PTW Interconnects
    reg        ptw_start;
    wire       ptw_busy;
    wire       ptw_done;
    wire       ptw_fault;

    // Latch Request details on handshake
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            latched_va    <= 32'b0;
            latched_user  <= 1'b0;
            latched_write <= 1'b0;
            latched_exec  <= 1'b0;
        end else begin
            if (req_valid && !mmu_busy) begin
                latched_va    <= req_addr;
                latched_user  <= req_user;
                latched_write <= req_write;
                latched_exec  <= req_execute;
            end
        end
    end

    // MMU Main State-Machine Sequential Block
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            mmu_state <= MMU_STATE_IDLE;
        end else begin
            mmu_state <= next_mmu_state;
        end
    end

    // State Transition Combinational Logic
    always @(*) begin
        next_mmu_state = mmu_state;
        
        case (mmu_state)
            MMU_STATE_IDLE: begin
                if (req_valid) begin
                    if (!enable) begin
                        next_mmu_state = MMU_STATE_SUCCESS; // Directly bypass
                    end else begin
                        next_mmu_state = MMU_STATE_LOOKUP;
                    end
                end
            end
            
            MMU_STATE_LOOKUP: begin
                if (tlb_hit) begin
                    if (tlb_fault_prot) begin
                        next_mmu_state = MMU_STATE_FAULT;
                    end else begin
                        next_mmu_state = MMU_STATE_SUCCESS;
                    end
                end else begin
                    next_mmu_state = MMU_STATE_WALKING; // Cache miss, start table-walk
                end
            end
            
            MMU_STATE_WALKING: begin
                if (ptw_fault) begin
                    next_mmu_state = MMU_STATE_FAULT;
                end else if (ptw_done) begin
                    next_mmu_state = MMU_STATE_RETRY; // Refill succeeded, retry lookup
                end
            end
            
            MMU_STATE_RETRY: begin
                // A 1-cycle delay to let the TLB write settle and lookup
                next_mmu_state = MMU_STATE_LOOKUP;
            end
            
            MMU_STATE_FAULT, MMU_STATE_SUCCESS: begin
                next_mmu_state = MMU_STATE_IDLE;
            end
            
            default: next_mmu_state = MMU_STATE_IDLE;
        endcase
    end

    // Combinational Output Assignments and En_signals
    always @(*) begin
        mmu_busy       = (mmu_state != MMU_STATE_IDLE);
        resp_valid     = (mmu_state == MMU_STATE_SUCCESS || mmu_state == MMU_STATE_FAULT);
        page_fault     = 1'b0;
        prot_fault     = 1'b0;
        resp_addr      = 32'b0;
        tlb_lookup_en  = 1'b0;
        ptw_start      = 1'b0;
        
        case (mmu_state)
            MMU_STATE_LOOKUP: begin
                tlb_lookup_en = 1'b1;
                if (tlb_hit && !tlb_fault_prot) begin
                    resp_addr = {tlb_ppn, latched_va[11:0]};
                end
            end
            
            MMU_STATE_WALKING: begin
                // Trigger page-walker if it is not already busy
                if (!ptw_busy) begin
                    ptw_start = 1'b1;
                end
            end
            
            MMU_STATE_RETRY: begin
                // Let TLB process refill
                tlb_lookup_en = 1'b1;
            end
            
            MMU_STATE_FAULT: begin
                resp_addr = latched_va; // Return VA in fault
                // Differentiate Fault types
                if (enable && tlb_hit && tlb_fault_prot) begin
                    prot_fault = 1'b1;
                end else if (enable && !tlb_hit) begin
                    // Walking generated fault
                    page_fault = 1'b1;
                end
            end
            
            MMU_STATE_SUCCESS: begin
                if (!enable) begin
                    resp_addr = latched_va; // 1:1 direct mapping
                end else begin
                    resp_addr = {tlb_ppn, latched_va[11:0]};
                end
            end
            
            default: ;
        endcase
    end

    // Instantiate TLB
    tlb #(
        .WAYS(2),
        .SETS(4),
        .ASID_WIDTH(8),
        .TAG_WIDTH(18),
        .PPN_WIDTH(20),
        .PERM_WIDTH(5)
    ) u_tlb (
        .clk(clk),
        .rst_n(rst_n),
        
        // Lookup Port
        .lookup_en(tlb_lookup_en),
        .lookup_vpn(latched_va[31:12]),
        .lookup_asid(asid),
        .req_user(latched_user),
        .req_write(latched_write),
        .req_execute(latched_exec),
        
        .tlb_hit(tlb_hit),
        .tlb_ppn(tlb_ppn),
        .tlb_fault_prot(tlb_fault_prot),
        
        // Refill Port (from PTW)
        .refill_en(refill_en),
        .refill_vpn(refill_vpn),
        .refill_asid(asid),
        .refill_ppn(refill_ppn),
        .refill_perms(refill_perms),
        
        // Invalidation
        .flush_all(flush_all),
        .flush_vpn(latched_va[31:12])
    );

    // Instantiate PTW
    ptw u_ptw (
        .clk(clk),
        .rst_n(rst_n),
        
        // Control
        .start_walk(ptw_start),
        .fault_va(latched_va),
        .satp_ppn(satp_ppn),
        
        .busy(ptw_busy),
        .walk_done(ptw_done),
        .walk_fault(ptw_fault),
        
        // Refill Signals to TLB
        .refill_vpn(refill_vpn),
        .refill_ppn(refill_ppn),
        .refill_perms(refill_perms),
        
        // Memory Bus
        .mem_req(mem_req),
        .mem_addr(mem_addr),
        .mem_rdata(mem_rdata),
        .mem_ready(mem_ready)
    );

    // Refill logic bridge
    assign refill_en = ptw_done;

endmodule
