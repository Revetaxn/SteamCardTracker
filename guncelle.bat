@echo off
chcp 65001 >nul
echo ========================================
echo   GitHub Guncelleyici - Steam Card Tracker
echo ========================================
echo.

:: Git yüklü mü kontrol et
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Git bulunamadi!
    pause
    exit /b 1
)

:: Commit mesajı sor
set /p MESAJ="Degisiklik aciklamasi (ornek: yeni ozellik eklendi): "
if "%MESAJ%"=="" set MESAJ=guncelleme

echo.
echo [1/4] Eski dosyalar temizleniyor...
git rm -r --cached . >nul 2>&1

echo [2/4] Yeni dosyalar ekleniyor...
git add .

echo [3/4] Commit olusturuluyor...
git commit -m "%MESAJ%"

echo [4/4] GitHub'a yukleniyor...
git push

echo.
if %errorlevel% equ 0 (
    echo ========================================
    echo   BASARILI! Vercel otomatik guncellenir.
    echo ========================================
) else (
    echo ========================================
    echo   HATA! Bir sorun olustu.
    echo ========================================
)

echo.
pause