/**
 * streamsaver.d.ts —— streamsaver（v2）自带类型；这里按实际用法声明。
 * 只声明我们用到的面：mitm 配置 + createWriteStream。
 */
declare module 'streamsaver' {
  interface StreamSaver {
    /** man-in-the-middle 页面地址（sw.js 由它注册），必须同源托管 */
    mitm: string;
    /** 是否认为可用（注意：实际能否用还要看 Service Worker / 安全上下文） */
    supported: boolean;
    WritableStream: typeof WritableStream;
    TransformStream?: typeof TransformStream;
    /**
     * 创建一个直接写进「浏览器下载」的 WritableStream。
     * 只接受 Uint8Array chunk；数据会经 Service Worker 通道落到磁盘（原生下载栏）。
     */
    createWriteStream(
      filename: string,
      options?: {
        size?: number;
        pathname?: string;
        writableStrategy?: QueuingStrategy<Uint8Array>;
        readableStrategy?: QueuingStrategy<Uint8Array>;
      },
    ): WritableStream<Uint8Array>;
  }
  const streamSaver: StreamSaver;
  export default streamSaver;
}
