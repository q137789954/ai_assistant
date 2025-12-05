import { NextResponse } from "next/server";

type ResponseHandler<T> = () => Promise<T> | T;

export type GlobalResponseOptions = {
  successStatus?: number;
  errorStatus?: number;
};

type SuccessBody<T> = {
  success: true;
  code: 0;
  data: T;
  meta: {
    timestamp: string;
  };
};

type ErrorBody = {
  success: false;
  code: 1;
  message: string;
  meta: {
    timestamp: string;
  };
};

export async function withGlobalResponse<T>(
  handler: ResponseHandler<T>,
  options: GlobalResponseOptions = {},
) {
  try {
    const data = await handler();
    const body: SuccessBody<T> = {
      success: true,
      code: 0,
      data,
      meta: { timestamp: new Date().toISOString() },
    };
    return NextResponse.json(body, {
      status: options.successStatus ?? 200,
    });
  } catch (error) {
    console.error("API middleware caught an error:", error);
    const body: ErrorBody = {
      success: false,
      code: 1,
      message:
        error instanceof Error ? error.message : "服务端发生未知错误",
      meta: { timestamp: new Date().toISOString() },
    };
    return NextResponse.json(body, {
      status: options.errorStatus ?? 500,
    });
  }
}
