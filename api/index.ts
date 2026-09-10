import dotenv from 'dotenv';
import { createApp } from '../src/app.ts';

dotenv.config();

const app = createApp();

export default app;
