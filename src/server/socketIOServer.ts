import { startSocketServer } from "./socketIO/server";

// 通过子模块封装具体逻辑后，此处仅触发服务启动。
startSocketServer();
