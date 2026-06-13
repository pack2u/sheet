const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const PROJECT_ROOT = path.resolve(__dirname, '..');
const IDE_DIR = __dirname;
const BACKUP_DIR = path.join(IDE_DIR, 'backup');

// 배제할 폴더 및 파일 패턴
const EXCLUDE_PATTERNS = [
    /^\.git$/,
    /^\.cursor$/,
    /^node_modules$/,
    /^antigravity_ide$/,
    /^\.DS_Store$/
];

// 보안 경로 검증 함수 (상위 경로 접근 차단)
function isValidPath(targetPath) {
    const absoluteTargetPath = path.resolve(PROJECT_ROOT, targetPath);
    return absoluteTargetPath.startsWith(PROJECT_ROOT);
}

// 재귀적으로 파일 트리 생성
async function getFileTree(dirPath, relativePath = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const tree = [];

    for (const entry of entries) {
        // 배제 패턴 검사
        if (EXCLUDE_PATTERNS.some(regex => regex.test(entry.name))) {
            continue;
        }

        const currentRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
        const currentAbsPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            const children = await getFileTree(currentAbsPath, currentRelPath);
            tree.push({
                name: entry.name,
                path: currentRelPath.replace(/\\/g, '/'),
                type: 'directory',
                children: children.sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                })
            });
        } else {
            tree.push({
                name: entry.name,
                path: currentRelPath.replace(/\\/g, '/'),
                type: 'file'
            });
        }
    }

    return tree.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

// 1. 파일 트리 조회 API
app.get('/api/files', async (req, res) => {
    try {
        const tree = await getFileTree(PROJECT_ROOT);
        res.json(tree);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: '파일 목록을 가져오는 중 오류가 발생했습니다.' });
    }
});

// 2. 파일 내용 조회 API
app.get('/api/file', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !isValidPath(filePath)) {
        return res.status(400).json({ error: '유효하지 않은 파일 경로입니다.' });
    }

    try {
        const absolutePath = path.resolve(PROJECT_ROOT, filePath);
        const data = await fs.readFile(absolutePath, 'utf8');
        res.json({ content: data });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: '파일을 읽는 중 오류가 발생했습니다.' });
    }
});

// 3. 파일 저장 API (저장 전 백업 파일 자동 생성)
app.post('/api/file', async (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || !isValidPath(filePath) || content === undefined) {
        return res.status(400).json({ error: '유효하지 않은 요청 데이터입니다.' });
    }

    const absolutePath = path.resolve(PROJECT_ROOT, filePath);

    try {
        // 기존 파일이 존재하면 백업 진행
        try {
            await fs.access(absolutePath);
            const originalContent = await fs.readFile(absolutePath, 'utf8');

            // 내용이 동일하면 저장/백업 스킵
            if (originalContent === content) {
                return res.json({ success: true, message: '변경된 내용이 없습니다.' });
            }

            // 백업 디렉토리 생성
            await fs.mkdir(BACKUP_DIR, { recursive: true });
            
            // 날짜 문자열 생성 (KST 기준)
            const date = new Date();
            const dateStr = date.getFullYear() +
                String(date.getMonth() + 1).padStart(2, '0') +
                String(date.getDate()).padStart(2, '0') + '_' +
                String(date.getHours()).padStart(2, '0') +
                String(date.getMinutes()).padStart(2, '0') +
                String(date.getSeconds()).padStart(2, '0');

            const fileExt = path.extname(filePath);
            const baseName = path.basename(filePath, fileExt);
            const backupFileName = `${baseName}_${dateStr}${fileExt}`;
            const backupPath = path.join(BACKUP_DIR, backupFileName);

            await fs.writeFile(backupPath, originalContent, 'utf8');
            console.log(`Backup created: ${backupFileName}`);
        } catch (err) {
            // 파일이 존재하지 않는 경우 (새 파일 생성) 백업은 생략함
        }

        // 파일 덮어쓰기
        await fs.writeFile(absolutePath, content, 'utf8');
        res.json({ success: true, message: '파일이 성공적으로 저장되었습니다.' });
    } catch (error) {
        console.error('Error writing file:', error);
        res.status(500).json({ error: '파일을 저장하는 중 오류가 발생했습니다.' });
    }
});

// 포트 충돌 방지 및 서버 시작
const DEFAULT_PORT = 3000;
function startServer(port) {
    const server = app.listen(port, 'localhost', () => {
        console.log(`==================================================`);
        console.log(`🚀 Antigravity IDE가 성공적으로 구동되었습니다.`);
        console.log(`👉 접속 주소: http://localhost:${port}`);
        console.log(`==================================================`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ 포트 ${port}번이 이미 사용 중입니다. 다음 포트를 시도합니다...`);
            startServer(port + 1);
        } else {
            console.error('서버 구동 에러:', err);
        }
    });
}

startServer(DEFAULT_PORT);
