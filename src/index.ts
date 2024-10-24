import {
  checkbox,
  input,
  password,
  select,
  Separator,
} from "@inquirer/prompts";
import { spawn } from "child_process";
import dayjs from "dayjs";
import Excel from "exceljs";
import fs, { readdirSync } from "fs";
import mysql from "mysql2/promise";
import path from "path";
import {
  DB_HOST,
  DB_PW,
  DB_USER,
  OUTPUT_DIR,
  VERSION,
} from "./common/variables";

const fileExists = fs.existsSync("./.env");
let controller = new AbortController();

const excludeSchemas = [
  "mysql",
  "test",
  "information_schema",
  "performance_schema",
];

if (fileExists) {
  console.log("환경변수파일을 적용합니다.");
} else {
  console.log("환경변수파일이 없습니다. 환경변수 적용 하려면 설정해주세요.");
  console.log(`
# .env example
DB_HOST = <host ip or domain>
DB_USER = <username>
DB_PW = <password>
OUTPUT_DIR = <"c:\\database_backup"> <default is ./>
`);
}

let globalOutputDir = "";
let username = DB_USER;
let passwd = DB_PW;

function runProcess() {
  getDbInfo().then(() => {
    function getConnection() {
      return mysql.createConnection({
        host: DB_HOST,
        user: username,
        password: passwd,
      });
    }
    getConnection()
      .then(async (conn: mysql.Connection) => {
        console.log("✨ 인증되었습니다.");
        await prompt(conn);
      })
      .catch(() => {
        username = "";
        passwd = "";
        runProcess();
      });
  });
}

runProcess();

async function prompt(conn: mysql.Connection) {
  const [databases] = await conn.query(
    `select schema_name from information_schema.\`schemata\` where schema_name not in (${excludeSchemas.map(
      () => "?"
    )})`,
    excludeSchemas
  );
  const databaseList = (databases as unknown as { schema_name: string }[]).map(
    ({ schema_name }) => schema_name
  );

  const schema: string = await select({
    message: "백업할 스키마를 선택하세요.",
    choices: [
      ...databaseList,
      new Separator(),
      "버전 확인",
      "설치 폴더 열기",
      "설치 폴더 선택 열기",
      "종료",
    ],
    loop: false,
  });
  // console.log(`✅ Selcted: ${schema}`);

  switch (true) {
    case schema === "버전 확인":
      console.log("✅ SQL Dump Version: %s", VERSION);
      prompt(conn);
      return;
    case databaseList.includes(schema):
      break;
    case schema === "설치 폴더 열기":
      await new Promise((resolve) => {
        const start = spawn("cmd", ["/C", "start", OUTPUT_DIR]);
        start.on("close", () => {
          resolve(true);
        });
      });
      prompt(conn);
      return;
    case schema === "설치 폴더 선택 열기":
      await selectOpen();
      prompt(conn);
      return;
    case schema === "종료":
      process.exit(0);
  }

  globalOutputDir = path.join(OUTPUT_DIR, "output", schema);

  await new Promise((resolve) => {
    const mkdir = spawn("mkdir", ["-p", globalOutputDir]);
    mkdir.on("close", () => {
      resolve(true);
    });
  });

  const choice = await select({
    message: "메뉴를 선택하세요.",
    choices: [
      "전체 테이블 xlsx,csv,sql로 내보내기",
      "선택 테이블 xlsx,csv,sql로 내보내기",
      new Separator(),
      "다른 스키마 선택",
      "종료",
    ],
  });

  switch (choice) {
    case "전체 테이블 xlsx,csv,sql로 내보내기":
      await allTableXlsxExport(conn, schema);
      console.log("✨ 저장되었습니다.");
      await openExportDir(schema);
      prompt(conn);
      break;
    case "선택 테이블 xlsx,csv,sql로 내보내기":
      await selectedTablesExport(conn, schema);
      await openExportDir(schema);
      prompt(conn);
      break;
    case "다른 스키마 선택":
      prompt(conn);
      break;
    case "종료":
      console.log("✨ 프로그램을 종료합니다.");
      process.exit(0);
  }
}

function modifyDateObj<T extends object>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      value instanceof Date
        ? dayjs(value).format("YYYY-MM-DD HH:mm:ss")
        : value,
    ])
  );
}

function modifyEncoding<T extends object>(obj: T) {
  const encoder = new TextEncoder();
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      Buffer.from(encoder.encode(value).buffer).toString(),
    ])
  );
}

async function openExportDir(schema: string) {
  const selected: string = await select({
    message: "저장된 폴더를 여시겠습니까?",
    choices: ["예", "아니오"],
    loop: false,
  });
  switch (selected) {
    case "예":
      await selectOpen(schema);
      break;
    case "아니오":
      break;
    default:
      openExportDir(schema);
      break;
  }
}

async function getDbInfo() {
  if (username === "") {
    username = await input({
      message: "데이터베이스 username을 적으세요.",
      required: true,
    });
  } else {
    const reinput = await select({
      message: "지정된 username으로 진행할까요?",
      choices: ["예", "직접입력하겠습니다."],
    });
    if (reinput === "직접입력하겠습니다.") {
      username = "";
    }
  }
  if (passwd === "") {
    passwd = await password({
      message: "데이터베이스 password을 적으세요.",
      mask: "#",
    });
  } else {
    const reinput = await select({
      message: "지정된 password으로 진행할까요?",
      choices: ["예", "직접입력하겠습니다."],
    });
    if (reinput === "직접입력하겠습니다.") {
      username = "";
    }
  }
  await new Promise((resolve) => {
    console.log("🛠️ 데이터베이스 접근 확인 중 입니다...", globalOutputDir);

    const sqlDump = spawn("mysql", [
      `-u${username}`,
      `-p${passwd}`,
      "-e",
      '"select 1"',
    ]);
    sqlDump.on("close", () => {
      resolve(true);
    });
  });
}

async function saveSqlProcess(schema: string) {
  // if (!(await getDbInfo())) {
  //   saveSqlProcess(schema);
  // }

  await new Promise((resolve) => {
    console.log("🛠️ sql 파일 저장 중입니다...", globalOutputDir);

    const sqlDump = spawn("cmd", [
      "/C",
      "mysqldump",
      `-u${username}`,
      `-p${passwd}`,
      "--routines",
      "--trigger",
      "--databases",
      schema,
      ">",
      `${path.join(globalOutputDir, `${schema}_output.sql`)}`,
    ]);
    sqlDump.on("close", () => {
      console.log(
        "✨ sql 파일 저장이 완료되었습니다!:",
        path.join(globalOutputDir, `${schema}_output.sql`)
      );
      resolve(true);
    });
  });
}

async function selectOpen(selected: string = "") {
  const dirs = readdirSync(path.join(OUTPUT_DIR, "output"));

  if (selected === "") {
    selected = await select({
      message: "폴더를 선택해주세요.",
      choices: [...dirs, new Separator(), "돌아가기"],
      loop: false,
    });
  }

  switch (true) {
    case dirs.includes(selected):
      await new Promise((resolve) => {
        const start = spawn("cmd", [
          "/C",
          "start",
          path.join(OUTPUT_DIR, "output", selected),
        ]);
        start.on("close", () => {
          resolve(true);
        });
      });
      break;
    case selected === "돌아가기":
    default:
      break;
  }
}

async function allTableXlsxExport(conn: mysql.Connection, schema: string) {
  await saveSqlProcess(schema);

  const [tables] = await conn.query(
    `select table_name from information_schema.\`tables\` where information_schema.\`tables\`.table_schema = ?`,
    [schema]
  );
  const tableNames = (tables as any[]).map(({ table_name }) => table_name);

  const workbook = new Excel.Workbook();
  workbook.creator = "kkn1125";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.lastPrinted = new Date();

  for (const table of tableNames) {
    const [columns] = await conn.query(
      `SELECT
                column_name
            FROM
                information_schema.\`columns\`
            WHERE
                information_schema.\`columns\`.table_schema = ?
                    AND information_schema.\`columns\`.table_name = ?
                ORDER BY ORDINAL_POSITION`,
      [schema, table]
    );
    await conn.query(`use ${schema}`);
    await conn.query(`set names utf8mb4`);
    const [rows] = await conn.query(`SELECT * FROM ${table}`);
    const columnNames = (columns as any[]).map(
      ({ column_name }) => column_name
    );
    const sheet = workbook.addWorksheet(table);
    sheet.columns = columnNames.map((column) => ({
      header: column,
      key: column,
      width: getColumnMaxLength(rows as any[], column, 2),
    }));
    sheet.addRows((rows as any[]).map((row) => modifyDateObj(row)));

    const csvWorkbook = new Excel.Workbook();
    csvWorkbook.creator = "kkn1125";
    csvWorkbook.created = new Date();
    csvWorkbook.modified = new Date();
    csvWorkbook.lastPrinted = new Date();

    const csvSheet = csvWorkbook.addWorksheet(table);
    csvSheet.columns = columnNames.map((column) => ({
      header: column,
      key: column,
    }));
    csvSheet.addRows(
      (rows as any[]).map((row) => modifyEncoding(modifyDateObj(row)))
    );

    const csvFilename = `${schema}_${table}.csv`;
    const csvFilePath = path.join(globalOutputDir, csvFilename);

    const csvBuffer = await csvWorkbook.csv.writeBuffer();
    const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    fs.writeFileSync(csvFilePath, Buffer.concat([bom, Buffer.from(csvBuffer)]));
  }

  const xlsxFilename = schema + "_all_tables.xlsx";
  await workbook.xlsx.writeFile(path.join(globalOutputDir, xlsxFilename));
  console.log(
    `✨ 테이블이 XLSX 파일로 저장되었습니다: ${path.join(
      globalOutputDir,
      xlsxFilename
    )}`
  );
}

// 선택한 테이블만 XLSX 및 CSV로 내보내기 함수
async function selectedTablesExport(conn: mysql.Connection, schema: string) {
  try {
    // 스키마 내 모든 테이블 이름 조회
    const [tables] = await conn.query(
      `SELECT table_name FROM information_schema.\`tables\` WHERE table_schema = ?`,
      [schema]
    );
    const tableNames = (tables as any[]).map(({ table_name }) => table_name);

    // 사용자에게 내보낼 테이블 선택하도록 프롬프트
    const selectedTables: string[] = await checkbox({
      message: "내보낼 테이블을 선택하세요.",
      choices: [...tableNames],
      // multiple: true, // 여러 개 선택 가능
    });
    console.log("selectedTables", selectedTables);

    if (selectedTables.includes("모든 테이블 선택")) {
      await allTableXlsxExport(conn, schema);
      return;
    }

    if (selectedTables.includes("취소")) {
      console.log("❌ 작업이 취소되었습니다.");
      return;
    }

    await saveSqlProcess(schema);

    // 선택한 테이블만 내보내기
    const workbook = new Excel.Workbook();
    workbook.creator = "kkn1125";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.lastPrinted = new Date();

    for (const table of selectedTables) {
      try {
        console.log(`Exporting table: ${table}`);

        // 테이블의 컬럼명 조회
        const [columns] = await conn.query(
          `SELECT column_name FROM information_schema.\`columns\` WHERE table_schema = ? AND table_name = ? ORDER BY ORDINAL_POSITION`,
          [schema, table]
        );
        const columnNames = (columns as any[]).map(
          ({ column_name }) => column_name
        );

        // 스키마 지정하여 테이블 데이터 조회
        const [rows] = await conn.query(
          `SELECT * FROM \`${schema}\`.\`${table}\``
        );

        // 워크시트 추가
        const sheet = workbook.addWorksheet(table);

        sheet.columns = columnNames.map((column) => ({
          header: column,
          key: column,
          width: getColumnMaxLength(rows as any[], column, 2),
        }));

        sheet.addRows((rows as any[]).map((row) => modifyDateObj(row)));

        // CSV 파일 생성
        const csvWorkbook = new Excel.Workbook();
        const csvSheet = csvWorkbook.addWorksheet(table);

        csvSheet.columns = columnNames.map((column) => ({
          header: column,
          key: column,
        }));

        csvSheet.addRows((rows as any[]).map((row) => modifyDateObj(row)));

        const csvFilename = `${schema}_${table}_selected.csv`;
        const csvFilePath = path.join(globalOutputDir, csvFilename);

        // UTF-8 BOM 추가하여 CSV 파일 저장
        const csvBuffer = await csvWorkbook.csv.writeBuffer();
        const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
        fs.writeFileSync(
          csvFilePath,
          Buffer.concat([bom, Buffer.from(csvBuffer)])
        );

        console.log(
          `✨선택한 테이블이 CSV 파일로 저장되었습니다: ${csvFilePath}`
        );
      } catch (error) {
        console.error(`Error exporting table ${table}:`, error);
      }
    }

    // XLSX 파일 저장
    const xlsxFilename = `${schema}_selected_tables.xlsx`;
    await workbook.xlsx.writeFile(path.join(globalOutputDir, xlsxFilename));
    console.log(
      `✨ 선택한 테이블이 XLSX 파일로 저장되었습니다: ${path.join(
        globalOutputDir,
        xlsxFilename
      )}`
    );
  } catch (error) {
    console.error("Error in selectedTablesExport:", error);
  }
}

function getPartialLength(text: string | number | Date) {
  switch (typeof text) {
    case "object":
      if (text instanceof Date) {
        return dayjs(text).format("YYYY-MM-DD HH:mm:ss").length;
      }
      return ("" + text).length;
    case "string":
    case "number":
    default:
      const wideLength = ("" + text).match(/[ㄱ-ㅎ가-힣]/g)?.length ?? 0;
      const middleLength = ("" + text).match(/[A-Z]/g)?.length ?? 0;
      const smallLength = ("" + text).match(/[^A-Zㄱ-ㅎ가-힣]/g)?.length ?? 0;
      return wideLength * 1.8 + middleLength * 1.3 + smallLength * 1;
  }
}

function getColumnMaxLength<T extends Record<string, any>>(
  rows: T[],
  column: string,
  padding: number = 0
) {
  let max = column.length;
  for (const row of rows) {
    const nextLength = getPartialLength(row[column]);
    if (max < nextLength) {
      max = nextLength;
    }
  }
  return max + padding;
}
