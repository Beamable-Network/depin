use solana_program::keccak;

#[inline(always)]
fn splitmix64(seed: u64) -> u64 {
    let mut z = seed.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

#[inline(always)]
fn create_seed(pubkey: &[u8], epoch: u16) -> u64 {
    let mut data = [0u8; 34];
    data[..32].copy_from_slice(&pubkey[..32]);
    data[32..34].copy_from_slice(&epoch.to_be_bytes());
    
    let hash = keccak::hash(&data);
    u64::from_be_bytes(hash.0[..8].try_into().unwrap())
}

pub fn generate_numbers(
    pubkey: &[u8],
    epoch: u16,
    count: usize,
    max_val: u64,
) -> Vec<u32> {
    let mut result = Vec::with_capacity(count);
    let mut current_seed = create_seed(pubkey, epoch);
    
    let bitmap_size = (max_val as usize + 63) >> 6;
    let mut bitmap = vec![0u64; bitmap_size];
    
    while result.len() < count {
        current_seed = splitmix64(current_seed);
        let v = (current_seed % max_val) as u32;
        
        let word_idx = (v as usize) >> 6;
        let bit_idx = (v as usize) & 63;
        let mask = 1u64 << bit_idx;
        
        let word = &mut bitmap[word_idx];
        if *word & mask == 0 {
            *word |= mask;
            result.push(v);
        }
    }
    
    result
}