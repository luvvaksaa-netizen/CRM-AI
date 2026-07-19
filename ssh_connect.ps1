Add-Type -AssemblyName System.Windows.Forms
$password = "O1fVmKlG9gdoQBYFr9ow"

# Use Windows SSH with password
$proc = Start-Process -FilePath "ssh" -ArgumentList "-o","StrictHostKeyChecking=no","-tt","root@103.74.5.62","whoami && node --version && pm2 list && df -h / && free -h && uptime && echo '---ENV---' && cat /root/.env 2>/dev/null || cat /var/data/crm/.env 2>/dev/null || echo 'NO .env FOUND'" -NoNewWindow -PassThru

# Wait a moment then send password
Start-Sleep 2
[System.Windows.Forms.SendKeys]::SendWait($password + "{ENTER}")

$proc.WaitForExit(15000)
