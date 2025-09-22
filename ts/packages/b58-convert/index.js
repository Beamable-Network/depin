import bs58 from 'bs58'

const input = process.argv[2];

const decodedBuffer = bs58.decode(input);

const byteArray = Array.from(decodedBuffer);

console.log("Byte array:");
console.log(byteArray);