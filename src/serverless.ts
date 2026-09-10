import dotenv from 'dotenv';
import { createApp } from './app.ts';

dotenv.config();

const app = createApp();

export default app;
