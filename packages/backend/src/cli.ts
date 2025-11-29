#!/usr/bin/env node

import { createBackendServer } from './server.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
TutorialKit Backend Server

Usage: tutorialkit-backend <command> [options]

Commands:
  start     Start the backend server

Options:
  --port    Port to listen on (default: 3001)
  --host    Host to bind to (default: 127.0.0.1)
  --help    Show this help message

Examples:
  tutorialkit-backend start
  tutorialkit-backend start --port 8080
  tutorialkit-backend start --host 0.0.0.0 --port 3001
`);
}

function parseArgs(args: string[]): { port: number; host: string } {
  let port = 3001;
  let host = '127.0.0.1';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[i + 1];
      i++;
    }
  }

  return { port, host };
}

const command = args[0];

if (command === '--help' || command === '-h' || !command) {
  printHelp();
  process.exit(0);
}

if (command === 'start') {
  const options = parseArgs(args.slice(1));
  const server = createBackendServer(options);
  server.start();
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
