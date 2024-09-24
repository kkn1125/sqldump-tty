import { select, checkbox, Separator } from "@inquirer/prompts";
import { execSync, spawn } from "child_process";
import dayjs from "dayjs";
import Excel from "exceljs";
import mysql from "mysql2/promise";
import path from "path";
import { DB_HOST, DB_PW, DB_USER, OUTPUT_DIR } from "./common/variables";
import fs from "fs";
import { Blob } from "buffer";

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
      "선택 테이블 xlsx로 내보내기",
      new Separator(),
      "다른 스키마 선택",
      "종료",
    ],
  });

  switch (choice) {
    case "전체 테이블 xlsx로 내보내기":
      await allTableXlsxExport(conn, schema);
      console.log("✨ 저장되었습니다.");
      prompt(conn);
      break;
    case "선택 테이블 xlsx로 내보내기":
      await selectedTablesExport(conn, schema);
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

async function allTableXlsxExport(conn: mysql.Connection, schema: string) {
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
    console.log("tableNames", tableNames);

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
