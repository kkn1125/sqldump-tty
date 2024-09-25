const path = require("path");
const nodeExternals = require("webpack-node-externals");

module.exports = {
  entry: "./src/index.ts",
  target: "node",
  externals: [nodeExternals()],
  mode: "production",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    preferRelative: true,
    alias: {
      // 'node:' 접두사를 제거하여 모듈을 참조하도록 설정
      "node:tty": "tty",
      // 필요한 다른 모듈들도 동일하게 설정
    },
    fallback: {
      fs: false,
      net: false,
      tls: false,
      tty: false,
      // 브라우저 환경에서 필요한 폴리필 설정
      // tty: require.resolve("tty-browserify"),
      // 필요한 다른 모듈들도 추가
    },
  },
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
  },
};
