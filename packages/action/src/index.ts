#!/usr/bin/env node
import { runAction } from "./main.js";

process.exitCode = await runAction(process.env, { stdout: process.stdout });
