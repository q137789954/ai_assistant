import { Socket } from "socket.io";
import { serializePayload } from "../../utils";
import { updateRoastBattleRound } from "../roastBattleRoundLoader";

/**
 * 根据 damage_delta 更新吐槽对战状态，并在胜利时下发通知。
 */
export const applyRoastBattleDamageDelta = async (params: {
  socket: Socket;
  clientId: string;
  conversationId: string;
  damageDelta: number;
}) => {
  const { socket, clientId, conversationId, damageDelta } = params;

  socket.data.roastBattleRound.score += damageDelta;
  socket.data.roastBattleRound!.roastCount += 1;

  if (socket.data.roastBattleRound.startedAt === null) {
    socket.data.roastBattleRound.startedAt = new Date();
  }

  if (socket.data.roastBattleRound!.score < 100) {
    return false;
  }

  // 分数达到 100 则关闭对战功能，等待下一回合加载
  socket.data.roastBattleEnabled = false;
  // 达到胜利分数线，标记回合为胜利
  socket.data.roastBattleRound!.isWin = true;
  // 记录胜利时间
  socket.data.roastBattleRound!.wonAt = new Date();
  await updateRoastBattleRound(socket.data.roastBattleRound);

  // 向客户端发送胜利通知
  const victoryPayload = serializePayload({
    event: "roast-battle-victory",
    data: {
      clientId,
      conversationId,
      message: "恭喜你在吐槽对战中取得胜利！",
    },
  });
  socket.emit("message", victoryPayload);
  return true;
};
