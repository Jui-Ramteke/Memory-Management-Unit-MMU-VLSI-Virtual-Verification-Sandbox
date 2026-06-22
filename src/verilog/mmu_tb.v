// =========================================================================
// Title: Self-Checking Testbench for RISC Memory Management Unit (MMU)
// Description: Implements a virtual test environment. Emulates clock, reset,
//              and main memory pages (BRAM) to verify TLB hits/misses, 
//              page-walking logic, protection faults, and context switches.
//              Generates a VCD wave file for RTL visualization.
// =========================================================================

`timescale 1ns / 1ps

module mmu_tb;

    // Clock and Reset Signals
    reg         clk;
    reg         rst_n;
    
    // MMU Inputs
    reg         mmu_enable;
    reg  [7:0]  mmu_asid;
    reg  [19:0] mmu_satp_ppn;
    
    reg         req_valid;
    reg  [31:0] req_addr;
    reg         req_user;
    reg         req_write;
    reg         req_execute;
    reg         flush_all;

    // MMU Outputs
    wire         resp_valid;
    wire [31:0]  resp_addr;
    wire         page_fault;
    wire         prot_fault;
    wire         mmu_busy;
    
    // Memory Interface (from MMU)
    wire         mem_req;
    wire [31:0]  mem_addr;
    reg  [31:0]  mem_rdata;
    reg          mem_ready;

    // Instantiate MMU Under Test (UUT)
    mmu u_mmu (
        .clk(clk),
        .rst_n(rst_n),
        .enable(mmu_enable),
        .asid(mmu_asid),
        .satp_ppn(mmu_satp_ppn),
        
        .req_valid(req_valid),
        .req_addr(req_addr),
        .req_user(req_user),
        .req_write(req_write),
        .req_execute(req_execute),
        
        .resp_valid(resp_valid),
        .resp_addr(resp_addr),
        .page_fault(page_fault),
        .prot_fault(prot_fault),
        .mmu_busy(mmu_busy),
        
        .mem_req(mem_req),
        .mem_addr(mem_addr),
        .mem_rdata(mem_rdata),
        .mem_ready(mem_ready),
        
        .flush_all(flush_all)
    );

    // Simulated BRAM - Main Memory representing Page-Tables
    // Simplification: We map memory locations dynamically using a lookup function
    always @(posedge clk) begin
        if (mem_req) begin
            mem_ready <= 1'b0;
            // Introduce a 1-cycle latency, mimicking standard synchronous SRAM
            #2;
            mem_ready <= 1'b1;
            
            // Latch structured page descriptors
            case (mem_addr)
                // SATP Root Table occupies 32'h01000000 base
                // VPN1 = 1: Address = 32'h01000004 -> points to L2 table at physical PPN 02000
                32'h01000004: mem_rdata <= {20'h02000, 12'h001}; // V=1, others=0 (Pointer to L2 Table)
                
                // VPN1 = 2: Address = 32'h01000008 -> points to L2 table at physical PPN 03000
                32'h01000008: mem_rdata <= {20'h03000, 12'h001}; // V=1, others=0 (Pointer to L2 Table)

                // Level-2 Page Table at 32'h02000000
                // VPN0 = 3: Address = 32'h0200000C -> physical page frame PPN 84000
                // Flags: User=1, Exec=0, Write=1, Read=1, Valid=1 (Config suffix: 12'h017)
                32'h0200000C: mem_rdata <= {20'h84000, 12'h017}; 

                // Level-2 Page Table at 32'h03000000  (Supervisor Mode / Read-Only mapping)
                // VPN0 = 5: Address = 32'h03000014 -> physical page frame PPN 95000
                // Flags: User=0 (Supervisor only), Exec=0, Write=0 (Read Only), Read=1, Valid=1 (Suffix: 12'h003)
                32'h03000014: mem_rdata <= {20'h95000, 12'h003};

                // Unmapped locations return invalid PTE (Valid bit = 0)
                default: mem_rdata <= 32'h00000000;
            endcase
        end else begin
            mem_ready <= 1'b0;
            mem_rdata <= 32'h0;
        end
    end

    // Clock Generator (50MHz -> T = 20ns)
    always #10 clk = ~clk;

    // Verification Stimulus Block
    initial begin
        // Initialize VCD dump for waveform inspections
        $dumpfile("mmu_wave.vcd");
        $dumpvars(0, mmu_tb);

        // System reset
        clk          = 1'b0;
        rst_n        = 1'b0;
        mmu_enable   = 1'b0;
        mmu_asid     = 8'hA1;
        mmu_satp_ppn = 20'h01000; // L1 Page Table base physical addresses: 20'h01000 -> 32'h01000000
        req_valid    = 1'b0;
        req_addr     = 32'b0;
        req_user     = 1'b0;
        req_write    = 1'b0;
        req_execute  = 1'b0;
        flush_all    = 1'b0;
        
        #40;
        rst_n = 1'b1;
        #20;
        
        $display("==========================================================");
        $display("[TB START] Initiating MMU RTL Self-checking Testbench");
        $display("==========================================================");

        // -------------------------------------------------------------
        // TESTCASE 1: Bypass Translation Mode
        // Description: Checks that when MMU is disabled, physical = virtual
        // -------------------------------------------------------------
        $display("[TESTCASE 1] Translation disabled (Bypass mode)");
        mmu_enable  = 1'b0;
        req_valid   = 1'b1;
        req_addr    = 32'hA000BBBB;
        req_user    = 1'b1;
        req_write   = 1'b0;
        req_execute = 1'b1;
        
        @(posedge clk);
        req_valid   = 1'b0; // deassert handshaking
        
        // Wait for response handshake
        while (!resp_valid) @(posedge clk);
        
        if (resp_addr == 32'hA000BBBB) begin
            $display("  -> SUCCESS: Direct mapping matches (Physical: %h)", resp_addr);
        end else begin
            $display("  -> ERROR: Direct mapping failed (Expected A000BBBB, Got: %h)", resp_addr);
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 2: TLB Miss / PTW Refill
        // Description: Enable VM translation. Query virtual address 32'h00403120 in User Read mode.
        //              Since TLB is cold, this must trigger TLB miss and run Page walk (PTW).
        //              PTE is at L1 (offset 1) -> L2 (offset 3) -> Physical PPN 84000.
        //              Expected output: 32'h84000120
        // -------------------------------------------------------------
        $display("[TESTCASE 2] TLB Miss / 1st translation Walk request: VA = 00403120");
        mmu_enable  = 1'b1;
        req_valid   = 1'b1;
        req_addr    = 32'h00403120; // VPN1 = 1, VPN0 = 3, offset = 120
        req_user    = 1'b1;         // Usermode
        req_write   = 1'b0;         // Read
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid = 1'b0;
        
        // Monitor walking states
        while (!resp_valid) begin
            if (mmu_busy && u_mmu.mmu_state == 3'd2) begin
                $display("  -> MMU State: WALKING, invoking hardware PTW...");
            end
            @(posedge clk);
        end
        
        if (resp_addr == 32'h84000120 && !page_fault && !prot_fault) begin
            $display("  -> SUCCESS: Walk completed! Translated Physical Addr: %h", resp_addr);
        end else begin
            $display("  -> ERROR: Decoded translation err (Expected 84000120, Got: %h, PageFault: %b, ProtFault: %b)", 
                     resp_addr, page_fault, prot_fault);
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 3: TLB Hit (Subsequent Access)
        // Description: Query the same VA = 31'h00403120. Entry is cached, must HIT immediately.
        // -------------------------------------------------------------
        $display("[TESTCASE 3] Verification of TLB Hit (subsequent cached lookup)");
        req_valid   = 1'b1;
        req_addr    = 32'h00403120;
        req_user    = 1'b1;
        req_write   = 1'b0;
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid   = 1'b0;
        
        @(posedge clk); // Lookups should terminate in 1 cycle
        if (resp_valid && resp_addr == 32'h84000120 && !mmu_busy) begin
            $display("  -> SUCCESS: Instant TLB Hit! Resolved in 1 cycle (Physical Addr: %h)", resp_addr);
        end else begin
            $display("  -> ERROR: TLB Hit verification failed (RespValid: %b, PAddr: %h)", resp_valid, resp_addr);
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 4: Page Fault (Unmapped Reference)
        // Description: Translate unmapped address VA = 32'h03C00000. Undergoes walk, returns fault.
        // -------------------------------------------------------------
        $display("[TESTCASE 4] Translation of unmapped page (Expected: Page Fault)");
        req_valid   = 1'b1;
        req_addr    = 32'h03C00000; // VPN1 = 15 (No valid PTE)
        req_user    = 1'b1;
        req_write   = 1'b0;
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid   = 1'b0;
        
        while (!resp_valid) @(posedge clk);
        
        if (page_fault) begin
            $display("  -> SUCCESS: Standard Page Fault caught by walk unit!");
        end else begin
            $display("  -> ERROR: Failed to assert page_fault flag for unmapped address");
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 5: Protection Fault (Supervisor Privilege violation)
        // Description: Address 32'h00805111 is supervisor occupied. 
        //              Usermode access request should trip protection guard.
        // -------------------------------------------------------------
        $display("[TESTCASE 5] Privilege level check violation: Usermode lookup on Supervisor page");
        req_valid   = 1'b1;
        req_addr    = 32'h00805111; // VPN1 = 2, VPN0 = 5, offset = 111
        req_user    = 1'b1;         // Usermode! (Privilege fault)
        req_write   = 1'b0;
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid   = 1'b0;
        
        while (!resp_valid) @(posedge clk);
        
        if (prot_fault) begin
            $display("  -> SUCCESS: Protection privilege fault caught! (Usermode accessing supervisor-only page)");
        end else begin
            $display("  -> ERROR: Supervisor protection fault bypassed!");
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 6: Supervisor Access / Write Protection Violation
        // Description: Supervisor mode should clear privilege checks, but write request
        //              on read-only mapping should cause a write protection fault!
        // -------------------------------------------------------------
        $display("[TESTCASE 6] Supervisor Mode bypasses privilege, but Write on Read-Only page checks");
        req_valid   = 1'b1;
        req_addr    = 32'h00805111; // Cached in TLB as Supervisor, Read-Only
        req_user    = 1'b0;         // Supervisor (Clears supervisor rule)
        req_write   = 1'b1;         // Write request (Fails RO rule)
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid   = 1'b0;
        
        while (!resp_valid) @(posedge clk);
        
        if (prot_fault) begin
            $display("  -> SUCCESS: Write protection fault caught successfully!");
        end else begin
            $display("  -> ERROR: Write protection check bypassed!");
        end
        #40;

        // -------------------------------------------------------------
        // TESTCASE 7: Successful Supervisor Read
        // Description: Correctly reading cached supervisor entry inside Supervisor permission.
        // -------------------------------------------------------------
        $display("[TESTCASE 7] Valid Supervisor reading supervisor-only page");
        req_valid   = 1'b1;
        req_addr    = 32'h00805111; 
        req_user    = 1'b0;         // Supervisor (OK!)
        req_write   = 1'b0;         // Read (OK!)
        req_execute = 1'b0;
        
        @(posedge clk);
        req_valid   = 1'b0;
        
        while (!resp_valid) @(posedge clk);
        
        if (!page_fault && !prot_fault && resp_addr == 32'h95000111) begin
            $display("  -> SUCCESS: Supervisor resolved Physical Address: %h!", resp_addr);
        end else begin
            $display("  -> ERROR: Supervisor evaluation failed (Addr: %h, PageFault: %b, ProtFault: %b)", 
                     resp_addr, page_fault, prot_fault);
        end
        #40;

        $display("==========================================================");
        $display("[TB END] All Verification cases completed!");
        $display("==========================================================");
        $finish;
    end

endmodule
