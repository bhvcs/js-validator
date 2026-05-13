<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Sample JSP</title>
</head>
<body>
  <h1>Hello JSP</h1>

  <script>
    const value = 10;
    function ok() {
      return value + 1;
    }
  </script>

  <script>
    function broken() {
      const x = ;
      return x;
    }
  </script>
</body>
</html>
