// =========================================================================
// Title: Parameterizable Set-Associative Translation Lookaside Buffer (TLB)
// Description: Multi-way set-associative TLB with pseudo-LRU replacement and 
//              ASID matching. Perfect for RISC style architectures.
// =========================================================================

`timescale 1ns / 1ps

module tlb #(
    parameter WAYS       = 2,       // Number of ways (typically 2 or 4)
    parameter SETS       = 4,       // Number of sets (index width = log2(SETS))
    parameter ASID_WIDTH = 8,       // Address Space ID width
    parameter TAG_WIDTH  = 18,      // VPN[19:2] (assuming 4 sets -> 2 index bits, 20 VPN bits)
    parameter PPN_WIDTH  = 20,      // Physical Page Number width
    parameter PERM_WIDTH = 5        // Permissions: [Valid, User, Readable, Writable, Executable]
)(
    input  wire                  clk,
    input  wire                  rst_n,
    
    // Lookup Interface
    input  wire                  lookup_en,
    input  wire [19:0]           lookup_vpn,
    input  wire [ASID_WIDTH-1:0] lookup_asid,
    input  wire                  req_user,       // 1 = Usermode, 0 = Supervisor
    input  wire                  req_write,      // Write request
    input  wire                  req_execute,    // Fetch execution request
    
    output reg                   tlb_hit,
    output reg  [PPN_WIDTH-1:0]  tlb_ppn,
    output reg                   tlb_fault_prot, // Protection fault (read/write/privilege violation)
    
    // Refill (Write) Interface
    input  wire                  refill_en,
    input  wire [19:0]           refill_vpn,
    input  wire [ASID_WIDTH-1:0] refill_asid,
    input  wire [PPN_WIDTH-1:0]  refill_ppn,
    input  wire [PERM_WIDTH-1:0] refill_perms,   // {V, U, R, W, X}
    
    // Invalidate Interface (flushes all or specific entry)
    input  wire                  flush_all,
    input  wire [19:0]           flush_vpn
);

    // Localparams for index and tag
    localparam INDEX_WIDTH = 2; // log2(4Sets) = 2
    
    // Extract Index and Tag from VPN
    wire [INDEX_WIDTH-1:0] lookup_idx = lookup_vpn[INDEX_WIDTH-1:0];
    wire [TAG_WIDTH-1:0]   lookup_tag = lookup_vpn[19:INDEX_WIDTH];
    
    wire [INDEX_WIDTH-1:0] refill_idx = refill_vpn[INDEX_WIDTH-1:0];
    wire [TAG_WIDTH-1:0]   refill_tag = refill_vpn[19:INDEX_WIDTH];

    // TLB Storage Array
    reg [TAG_WIDTH-1:0]   tag_array  [SETS-1:0][WAYS-1:0];
    reg [ASID_WIDTH-1:0]  asid_array [SETS-1:0][WAYS-1:0];
    reg [PPN_WIDTH-1:0]   ppn_array  [SETS-1:0][WAYS-1:0];
    reg [PERM_WIDTH-1:0]  perm_array [SETS-1:0][WAYS-1:0]; // {V, U, R, W, X}
    
    // Pseudo-LRU Tracking (For 2-way, 1 bit per set monitors which way is least-recently used)
    reg [WAYS-2:0] lru_array [SETS-1:0]; 

    // Internal Hit signals per way
    reg [WAYS-1:0] way_hit;
    integer i, j;

    // Combinational lookup matching
    always @(*) begin
        way_hit = {WAYS{1'b0}};
        if (lookup_en) begin
            for (i = 0; i < WAYS; i = i + 1) begin
                // Check valid bit, tag, and ASID (skip ASID check if global page - standard RISC VM trick)
                // In our simple model, we assume page is matching if valid and tag matches and ASID matches
                if (perm_array[lookup_idx][i][4] && // Valid
                    (tag_array[lookup_idx][i] == lookup_tag) &&
                    (asid_array[lookup_idx][i] == lookup_asid)) begin
                    way_hit[i] = 1'b1;
                end
            end
        end
    end

    // Hit decision & protection checks
    always @(*) begin
        tlb_hit        = 1'b0;
        tlb_ppn        = {PPN_WIDTH{1'b0}};
        tlb_fault_prot = 1'b0;
        
        if (lookup_en) begin
            if (|way_hit) begin
                tlb_hit = 1'b1;
                // Extract matched physical frame and permissions
                for (i = 0; i < WAYS; i = i + 1) begin
                    if (way_hit[i]) begin
                        tlb_ppn = ppn_array[lookup_idx][i];
                        
                        // Permissions analysis:
                        // perm_array block contains: [Valid, User, Readable, Writable, Executable]
                        // Index representation: V=4, U=3, R=2, W=1, X=0
                        // 1. Check Privilege Mode: 
                        // If supervisor request but page is User? That's fine on some architectures, but
                        // If user requests supervisor page (User bit == 0) -> Fail
                        if (req_user && !perm_array[lookup_idx][i][3]) begin
                            tlb_fault_prot = 1'b1;
                        end
                        // 2. Check Execution:
                        else if (req_execute && !perm_array[lookup_idx][i][0]) begin
                            tlb_fault_prot = 1'b1;
                        end
                        // 3. Check Write protection:
                        else if (req_write && !perm_array[lookup_idx][i][1]) begin
                            tlb_fault_prot = 1'b1;
                        end
                        // 4. Default Read:
                        else if (!req_execute && !req_write && !perm_array[lookup_idx][i][2]) begin
                            tlb_fault_prot = 1'b1;
                        end
                    end
                end
            end
        end
    end

    // Sequential updates: Refills, LRU updates, Flushes and Resets
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            // Reset all arrays
            for (i = 0; i < SETS; i = i + 1) begin
                lru_array[i] <= {WAYS-1{1'b0}};
                for (j = 0; j < WAYS; j = j + 1) begin
                    tag_array[i][j]  <= {TAG_WIDTH{1'b0}};
                    asid_array[i][j] <= {ASID_WIDTH{1'b0}};
                    ppn_array[i][j]  <= {PPN_WIDTH{1'b0}};
                    perm_array[i][j] <= {PERM_WIDTH{1'b0}}; // Valid = 0
                end
            end
        end else begin
            // Inval procedures (Flush)
            if (flush_all) begin
                for (i = 0; i < SETS; i = i + 1) begin
                    for (j = 0; j < WAYS; j = j + 1) begin
                        perm_array[i][j][4] <= 1'b0; // set valid bit to 0
                    end
                end
            end 
            else if (lookup_en && tlb_hit && !tlb_fault_prot) begin
                // Update LRU on hit
                // If Way0 hit, setting LRU bit = 1 indicates Way1 is less-recently used
                // If Way1 hit, setting LRU bit = 0 indicates Way0 is less-recently used
                if (way_hit[0]) lru_array[lookup_idx] <= 1'b1;
                if (way_hit[1]) lru_array[lookup_idx] <= 1'b0;
            end 
            else if (refill_en) begin
                // Select way to overwrite based on LRU
                // (0 = way 0 is LRU, 1 = way 1 is LRU)
                if (lru_array[refill_idx] == 1'b0) begin
                    tag_array[refill_idx][0]  <= refill_tag;
                    asid_array[refill_idx][0] <= refill_asid;
                    ppn_array[refill_idx][0]  <= refill_ppn;
                    perm_array[refill_idx][0] <= refill_perms;
                    lru_array[refill_idx]     <= 1'b1; // now way 1 is older
                end else begin
                    tag_array[refill_idx][1]  <= refill_tag;
                    asid_array[refill_idx][1] <= refill_asid;
                    ppn_array[refill_idx][1]  <= refill_ppn;
                    perm_array[refill_idx][1] <= refill_perms;
                    lru_array[refill_idx]     <= 1'b0; // now way 0 is older
                end
            end
        end
    end

endmodule
