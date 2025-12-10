import "dotenv/config";
import { startSocketServer } from "./socketIO/server";

// 先加载环境变量配置，再唤起 socket 服务启动逻辑。
startSocketServer();
