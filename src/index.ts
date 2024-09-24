import { select, Separator } from "@inquirer/prompts";
import { execSync, spawn } from "child_process";
import dayjs from "dayjs";
import Excel from "exceljs";
import mysql from "mysql2/promise";
import path from "path";
import { DB_HOST, DB_PW, DB_USER, OUTPUT_DIR } from "./common/variables";

let globalOutputDir = "";

function getConnection() {
  return mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PW,
  });
}

getConnection().then(async (conn: mysql.Connection) => {
  await prompt(conn);
});

async function prompt(conn: mysql.Connection) {
  const [databases] = await conn.query(
    "select schema_name from information_schema.`schemata` where schema_name != 'mysql' and schema_name != 'test' and schema_name != 'information_schema'"
  );

  const schema: string = await select({
    message: "백업할 스키마를 선택하세요.",
    choices: (databases as any[]).map(({ schema_name }) => schema_name),
  });
  console.log(`✅ Selcted: ${schema}`);
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
      "전체 테이블 xlsx로 내보내기",
      "선택한 테이블 xlsx로 내보내기",
      new Separator(),
      "다른 스키마 선택",
      "종료",
    ],
  });

  switch (choice) {
    case "전체 테이블 xlsx로 내보내기":
      const xlsx = await allTableXlsxExport(conn, schema);
      const filename = schema + "_all.xlsx";
      await xlsx.writeFile(path.join(globalOutputDir, filename));
      console.log("✨ 저장되었습니다.");
      prompt(conn);
      break;
    case "선택 테이블 xlsx로 내보내기":
      break;
    case "다른 스키마 선택":
      prompt(conn);
      break;
    case "종료":
      process.exit(0);
  }

  console.log(`menu: ${choice}`);
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

async function allTableXlsxExport(
  conn: mysql.Connection,
  schema: string
): Promise<Excel.Xlsx> {
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
    const csvWorkbook = new Excel.Workbook();
    csvWorkbook.creator = "kkn1125";
    csvWorkbook.created = new Date();
    csvWorkbook.modified = new Date();
    csvWorkbook.lastPrinted = new Date();

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
    await conn.query(`set names utf8`);
    const [rows] = await conn.query(`SELECT * FROM ${table}`);
    const columnNames = (columns as any[]).map(
      ({ column_name }) => column_name
    );
    const sheet = workbook.addWorksheet(table);
    const csvSheet = csvWorkbook.addWorksheet(table);

    sheet.columns = columnNames.map((column) => ({
      header: column,
      key: column,
      width: getColumnMaxLength(rows as any[], column, 2),
    }));

    csvSheet.columns = columnNames.map((column) => ({
      header: column,
      key: column,
      width: getColumnMaxLength(rows as any[], column, 2),
    }));

    if (table === "mainnotice") {
      console.log(rows);
    }

    sheet.addRows((rows as any[]).map((row) => modifyDateObj(row)));
    csvSheet.addRows((rows as any[]).map((row) => modifyDateObj(row)));

    const filename = schema + "_" + table + ".csv";
    await csvWorkbook.csv.writeFile(path.join(globalOutputDir, filename), {
      encoding: "utf-8",
    });
  }
  return workbook.xlsx;

  
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
      const wideLength = ("" + text).match(/[A-Zㄱ-ㅎ가-힣]/g)?.length ?? 0;
      const smallLength = ("" + text).match(/[^A-Zㄱ-ㅎ가-힣]/g)?.length ?? 0;
      return wideLength * 2 + smallLength * 0.5;
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
