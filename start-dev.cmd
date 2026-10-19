@echo off
cd /d C:\Users\it_st\Downloads\uptimepulse\uptimepulse
set NODE_ENV=development
call node_modules\.bin\tsx watch server/_core/index.ts > dev-server.log 2>&1
