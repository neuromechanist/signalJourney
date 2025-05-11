#!/usr/bin/env python3
"""
Basic Python functions for testing the parser
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

def simple_function(a, b, c=10):
    """A simple function with basic parameters."""
    return a + b + c

def process_signal(signal, fs=1000, filter_type='lowpass'):
    """Process a signal with filtering and normalization."""
    from scipy import signal as sig
    
    # Create a Butterworth filter
    b, a = sig.butter(4, 30/(fs/2), filter_type)
    
    # Apply the filter
    filtered = sig.filtfilt(b, a, signal)
    
    # Normalize
    normalized = filtered / np.max(np.abs(filtered))
    
    return normalized, np.arange(len(normalized))/fs

def analyze_signal(data, sampling_rate):
    """Analyze a signal with FFT and plot the results."""
    # Compute FFT
    fft_data = np.fft.fft(data)
    n = len(data)
    freq = np.arange(n//2) * (sampling_rate / n)
    
    # Get amplitude
    amplitude = np.abs(fft_data[:n//2])
    
    # Plot the results
    plt.figure(figsize=(10, 6))
    plt.plot(freq, amplitude)
    plt.title('Frequency Domain')
    plt.xlabel('Frequency (Hz)')
    plt.ylabel('Amplitude')
    plt.grid(True)
    plt.show()
    
    return freq, amplitude

class SignalProcessor:
    """A class for signal processing."""
    
    def __init__(self, sample_rate=1000):
        """Initialize the signal processor."""
        self.fs = sample_rate
        self.data = None
    
    def normalize(self, data=None):
        """Normalize signal to range [-1, 1]."""
        if data is None:
            data = self.data
        return data / np.max(np.abs(data))
    
    def filter(self, data=None, cutoff=30, filter_type='lowpass'):
        """Apply a filter to the data."""
        from scipy import signal as sig
        
        if data is None:
            data = self.data
        
        b, a = sig.butter(4, cutoff/(self.fs/2), filter_type)
        return sig.filtfilt(b, a, data)
    
    def process(self, data):
        """Process signal with multiple steps."""
        self.data = data
        
        # Apply filtering
        filtered = self.filter(data)
        
        # Normalize
        processed = self.normalize(filtered)
        
        return processed

# Example usage
if __name__ == "__main__":
    # Generate a test signal
    t = np.linspace(0, 1, 1000)
    signal = np.sin(2*np.pi*10*t) + 0.5*np.sin(2*np.pi*50*t) + 0.2*np.random.randn(len(t))
    
    # Process the signal
    filtered_signal, time_axis = process_signal(signal)
    
    # Analyze the signal
    freq, amplitude = analyze_signal(filtered_signal, 1000)
    
    # Use the class
    processor = SignalProcessor()
    processed = processor.process(signal)
    
    # Print results
    result = simple_function(10, 20)
    print(f"Simple function result: {result}") 