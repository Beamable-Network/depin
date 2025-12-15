use borsh::{BorshDeserialize, BorshSerialize};

/// A generic ring buffer with fixed capacity
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct RingBuffer<T, const N: usize> {
    /// The buffer array
    pub data: [T; N],
    /// Current write index (0 to N-1)
    pub current_index: u8,
}

impl<T, const N: usize> RingBuffer<T, N>
where
    T: Default + Copy + PartialEq,
{
    /// Creates a new ring buffer with default values
    pub fn new() -> Self {
        Self {
            data: [T::default(); N],
            current_index: 0,
        }
    }

    /// Adds a new element to the ring buffer
    /// Overwrites the oldest element when buffer is full
    pub fn push(&mut self, item: T) {
        self.data[self.current_index as usize] = item;
        self.current_index = (self.current_index + 1) % (N as u8);
    }

    /// Gets an element at a specific index
    pub fn get(&self, index: usize) -> Option<&T> {
        if index < N {
            Some(&self.data[index])
        } else {
            None
        }
    }

    /// Returns the total capacity of the buffer
    pub const fn capacity(&self) -> usize {
        N
    }

    /// Returns an iterator over all elements in the buffer
    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.data.iter()
    }

    /// Returns an iterator over non-default elements in the buffer
    pub fn iter_non_default(&self) -> impl Iterator<Item = &T> {
        self.data.iter().filter(move |&item| *item != T::default())
    }

    /// Finds the first element that matches a predicate
    pub fn find<F>(&self, predicate: F) -> Option<&T>
    where
        F: Fn(&T) -> bool,
    {
        self.data.iter().find(|&item| predicate(item))
    }

    /// Checks if the buffer contains an element matching a predicate
    pub fn contains<F>(&self, predicate: F) -> bool
    where
        F: Fn(&T) -> bool,
    {
        self.find(predicate).is_some()
    }

    /// Collects all non-default elements into a vector
    pub fn to_vec(&self) -> Vec<T> {
        self.iter_non_default().copied().collect()
    }

    /// Returns the current write index
    pub fn current_index(&self) -> u8 {
        self.current_index
    }

    /// Returns the index of the last written element, or None if buffer is empty
    pub fn get_last_index(&self) -> Option<usize> {
        let last_idx = if self.current_index == 0 {
            N - 1
        } else {
            self.current_index as usize - 1
        };

        // Check if the buffer has any non-default values
        if self.data[last_idx] == T::default() {
            None
        } else {
            Some(last_idx)
        }
    }
}

impl<T, const N: usize> Default for RingBuffer<T, N>
where
    T: Default + Copy + PartialEq,
{
    fn default() -> Self {
        Self::new()
    }
}
