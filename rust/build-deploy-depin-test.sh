#!/bin/bash

cargo build-sbf --features test --sbf-out-dir=target/test && solana program deploy target/test/depin.so